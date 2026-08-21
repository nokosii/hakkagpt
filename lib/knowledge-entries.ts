import { ensureSchema } from "@/db/runtime";
import {
  deleteDriveKnowledgeEntries,
  googleDriveStatus,
  loadDriveKnowledgeEntries,
  updateDriveKnowledgeEntry,
  uploadKnowledgeEntryToDrive,
  type DriveKnowledgeEntry,
} from "@/lib/google-drive";
import {
  EMPTY_REVIEW_GATES,
  governanceFromRow,
  normalizeGovernance,
  normalizeReviewGates,
  type GovernanceMetadata,
  type ReviewGates,
} from "@/lib/governance";

export type KnowledgeEntryRecord = {
  id: string;
  term: string;
  slug: string;
  summary: string;
  content: string;
  source_url: string | null;
  status: "pending" | "approved" | "rejected";
  author_id: string;
  author_email: string;
  reviewer_email: string | null;
  review_note: string | null;
  created_at: number;
  reviewed_at: number | null;
  governance: GovernanceMetadata;
  review_gates: ReviewGates;
};

type DatabaseEntryRow = Omit<KnowledgeEntryRecord, "governance" | "review_gates"> & {
  dialect: string | null;
  rights_holder: string | null;
  rights_basis: string | null;
  license: string | null;
  access_level: string | null;
  community_benefit: string | null;
  consent_confirmed: number | null;
  review_gates_json: string | null;
};

function fromDrive(entry: Awaited<ReturnType<typeof loadDriveKnowledgeEntries>>[number]): KnowledgeEntryRecord {
  return {
    id: entry.id,
    term: entry.term,
    slug: entry.slug,
    summary: entry.summary,
    content: entry.content,
    source_url: entry.sourceUrl,
    status: entry.status,
    author_id: entry.authorId,
    author_email: entry.authorEmail,
    reviewer_email: entry.reviewerEmail,
    review_note: entry.reviewNote,
    created_at: entry.createdAt,
    reviewed_at: entry.reviewedAt,
    governance: normalizeGovernance(entry.governance),
    review_gates: normalizeReviewGates(entry.reviewGates),
  };
}

function toDrive(entry: KnowledgeEntryRecord): DriveKnowledgeEntry {
  return {
    version: 1,
    id: entry.id,
    term: entry.term,
    slug: entry.slug,
    summary: entry.summary,
    content: entry.content,
    sourceUrl: entry.source_url,
    status: entry.status,
    authorId: entry.author_id,
    authorEmail: entry.author_email,
    reviewerEmail: entry.reviewer_email,
    reviewNote: entry.review_note,
    createdAt: entry.created_at,
    reviewedAt: entry.reviewed_at,
    governance: entry.governance,
    reviewGates: entry.review_gates,
  };
}

function parseReviewGates(value: string | null) {
  if (!value) return EMPTY_REVIEW_GATES;
  try {
    return normalizeReviewGates(JSON.parse(value));
  } catch {
    return EMPTY_REVIEW_GATES;
  }
}

export async function listKnowledgeEntries(limit = 500) {
  const entries = new Map<string, KnowledgeEntryRecord>();
  try {
    const DB = await ensureSchema();
    const result = await DB.prepare(`SELECT r.id, r.term, r.slug, r.summary, r.content, r.source_url,
        r.status, r.author_id, r.author_email, r.reviewer_email, r.review_note, r.created_at, r.reviewed_at,
        g.dialect, g.rights_holder, g.rights_basis, g.license, g.access_level,
        g.community_benefit, g.consent_confirmed, g.review_gates AS review_gates_json
      FROM knowledge_revisions r
      LEFT JOIN knowledge_governance g ON g.record_id = r.id AND g.record_kind = 'entry'
      ORDER BY r.created_at DESC
      LIMIT ?`).bind(Math.max(1, Math.min(limit, 5000))).all<DatabaseEntryRow>();
    for (const row of result.results as unknown as DatabaseEntryRow[] || []) {
      const entry: KnowledgeEntryRecord = {
        ...row,
        governance: governanceFromRow(row as unknown as Record<string, unknown>),
        review_gates: parseReviewGates(row.review_gates_json),
      };
      entries.set(entry.id, entry);
    }
  } catch {
    // Render 沒有 D1 時，詞條由 Google Drive 提供。
  }

  if (googleDriveStatus().configured) {
    const driveEntries = await loadDriveKnowledgeEntries();
    for (const driveEntry of driveEntries) {
      const entry = fromDrive(driveEntry);
      const current = entries.get(entry.id);
      if (!current || (entry.reviewed_at || entry.created_at) >= (current.reviewed_at || current.created_at)) {
        entries.set(entry.id, entry);
      }
    }
  }

  return [...entries.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

export async function createKnowledgeEntry(entry: KnowledgeEntryRecord) {
  let stored = false;
  let firstError: unknown;

  if (googleDriveStatus().configured) {
    try {
      await uploadKnowledgeEntryToDrive(toDrive(entry));
      stored = true;
    } catch (error) {
      firstError = error;
    }
  }

  try {
    const DB = await ensureSchema();
    await DB.batch([DB.prepare(`INSERT INTO knowledge_revisions (
        id, term, slug, summary, content, source_url, status,
        author_id, author_email, reviewer_email, review_note, created_at, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      entry.id,
      entry.term,
      entry.slug,
      entry.summary,
      entry.content,
      entry.source_url,
      entry.status,
      entry.author_id,
      entry.author_email,
      entry.reviewer_email,
      entry.review_note,
      entry.created_at,
      entry.reviewed_at,
    ), DB.prepare(`INSERT OR REPLACE INTO knowledge_governance (
        record_id, record_kind, dialect, rights_holder, rights_basis, license,
        access_level, community_benefit, consent_confirmed, review_gates, withdrawn_at, updated_at
      ) VALUES (?, 'entry', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).bind(
      entry.id,
      entry.governance.dialect,
      entry.governance.rightsHolder,
      entry.governance.rightsBasis,
      entry.governance.license,
      entry.governance.accessLevel,
      entry.governance.communityBenefit,
      entry.governance.consentConfirmed ? 1 : 0,
      JSON.stringify(entry.review_gates),
      entry.created_at,
    )]);
    stored = true;
  } catch (error) {
    firstError ||= error;
  }

  if (!stored) throw firstError instanceof Error ? firstError : new Error("詞條儲存空間尚未連線");
}

export async function reviewKnowledgeEntry(
  id: string,
  status: "approved" | "rejected",
  note: string,
  reviewerEmail: string,
  reviewGates: ReviewGates = EMPTY_REVIEW_GATES,
) {
  const reviewedAt = Date.now();
  let changed = false;
  let firstError: unknown;

  if (googleDriveStatus().configured) {
    try {
      const entries = await loadDriveKnowledgeEntries();
      const entry = entries.find((candidate) => candidate.id === id && candidate.status === "pending");
      if (entry) {
        await updateDriveKnowledgeEntry({
          ...entry,
          status,
          reviewerEmail,
          reviewNote: note || null,
          reviewGates,
          reviewedAt,
        });
        changed = true;
      }
    } catch (error) {
      firstError = error;
    }
  }

  try {
    const DB = await ensureSchema();
    const [result] = await DB.batch([
      DB.prepare(`UPDATE knowledge_revisions
        SET status = ?, reviewer_email = ?, review_note = ?, reviewed_at = ?
        WHERE id = ? AND status = 'pending'`)
        .bind(status, reviewerEmail, note || null, reviewedAt, id),
      DB.prepare(`INSERT INTO knowledge_governance (
          record_id, record_kind, review_gates, updated_at
        ) VALUES (?, 'entry', ?, ?)
        ON CONFLICT(record_id) DO UPDATE SET review_gates = excluded.review_gates,
          updated_at = excluded.updated_at`)
        .bind(id, JSON.stringify(reviewGates), reviewedAt),
    ]);
    if (result.meta.changes) changed = true;
  } catch (error) {
    firstError ||= error;
  }

  if (!changed && firstError) throw firstError;
  return changed;
}

export async function deleteKnowledgeEntries(ids: string[]) {
  const uniqueIds = [...new Set(ids)].slice(0, 200);
  let deleted = 0;
  let firstError: unknown;

  if (googleDriveStatus().configured) {
    try {
      deleted = Math.max(deleted, await deleteDriveKnowledgeEntries(uniqueIds));
    } catch (error) {
      firstError = error;
    }
  }

  try {
    const DB = await ensureSchema();
    const deletions = uniqueIds.flatMap((id) => [
      DB.prepare("DELETE FROM knowledge_governance WHERE record_id = ? AND record_kind = 'entry'").bind(id),
      DB.prepare("DELETE FROM knowledge_revisions WHERE id = ? AND author_id <> 'system'").bind(id),
    ]);
    const results = await DB.batch(deletions);
    const databaseDeleted = results
      .filter((_, index) => index % 2 === 1)
      .reduce((sum, result) => sum + (result.meta.changes || 0), 0);
    deleted = Math.max(deleted, databaseDeleted);
  } catch (error) {
    firstError ||= error;
  }

  if (!deleted && firstError) throw firstError;
  return deleted;
}
