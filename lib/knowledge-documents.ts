import { ensureSchema, getPlatformEnv } from "@/db/runtime";
import {
  deleteDriveKnowledgeDocuments,
  googleDriveStatus,
  loadDriveKnowledgeIndexes,
  updateDriveKnowledgeIndex,
} from "@/lib/google-drive";
import {
  EMPTY_REVIEW_GATES,
  governanceFromRow,
  normalizeGovernance,
  normalizeReviewGates,
  type GovernanceMetadata,
  type ReviewGates,
} from "@/lib/governance";

export type KnowledgeDocumentRecord = {
  id: string;
  file_name: string;
  file_type: "csv" | "pdf";
  object_key: string;
  byte_size: number;
  page_count: number | null;
  row_count: number | null;
  chunk_count: number;
  status: "pending" | "approved" | "rejected";
  owner_id: string;
  owner_email: string;
  created_at: number;
  reviewer_email: string | null;
  review_note: string | null;
  reviewed_at: number | null;
  governance: GovernanceMetadata;
  review_gates: ReviewGates;
};

type DatabaseDocumentRow = Omit<KnowledgeDocumentRecord, "governance" | "review_gates" | "status"> & {
  raw_status: string;
  dialect: string | null;
  rights_holder: string | null;
  rights_basis: string | null;
  license: string | null;
  access_level: string | null;
  community_benefit: string | null;
  consent_confirmed: number | null;
  review_gates_json: string | null;
};

function parseGates(value: string | null) {
  if (!value) return EMPTY_REVIEW_GATES;
  try {
    return normalizeReviewGates(JSON.parse(value));
  } catch {
    return EMPTY_REVIEW_GATES;
  }
}

function databaseStatus(value: string): KnowledgeDocumentRecord["status"] {
  if (value === "approved" || value === "rejected") return value;
  return "pending";
}

export async function listKnowledgeDocuments(limit = 500) {
  const documents = new Map<string, KnowledgeDocumentRecord>();
  try {
    const DB = await ensureSchema();
    const result = await DB.prepare(`SELECT d.id, d.file_name, d.file_type, d.object_key,
        d.byte_size, d.page_count, d.row_count, d.chunk_count, d.status AS raw_status,
        d.owner_id, d.owner_email, d.created_at, g.reviewer_email, g.review_note, g.reviewed_at,
        g.dialect, g.rights_holder, g.rights_basis, g.license, g.access_level,
        g.community_benefit, g.consent_confirmed, g.review_gates AS review_gates_json
      FROM knowledge_documents d
      LEFT JOIN knowledge_governance g ON g.record_id = d.id AND g.record_kind = 'document'
      ORDER BY d.created_at DESC LIMIT ?`)
      .bind(Math.max(1, Math.min(limit, 5000)))
      .all<DatabaseDocumentRow>();
    for (const row of result.results || []) {
      documents.set(row.id, {
        ...row,
        status: databaseStatus(row.raw_status),
        governance: governanceFromRow(row as unknown as Record<string, unknown>),
        review_gates: parseGates(row.review_gates_json),
      });
    }
  } catch {
    // Render 沒有 D1 時，文件資料由 Google Drive 索引提供。
  }

  if (googleDriveStatus().configured) {
    const indexes = await loadDriveKnowledgeIndexes();
    for (const index of indexes) {
      const record: KnowledgeDocumentRecord = {
        id: index.knowledgeId,
        file_name: index.fileName,
        file_type: index.fileType,
        object_key: `gdrive:${index.originalFileId}`,
        byte_size: index.byteSize,
        page_count: index.pageCount,
        row_count: index.rowCount,
        chunk_count: index.chunks.length,
        status: index.reviewStatus === "approved" || index.reviewStatus === "rejected"
          ? index.reviewStatus
          : "pending",
        owner_id: index.ownerId || "unknown",
        owner_email: index.ownerEmail || "未標示",
        created_at: index.createdAt,
        reviewer_email: index.reviewerEmail || null,
        review_note: index.reviewNote || null,
        reviewed_at: index.reviewedAt || null,
        governance: normalizeGovernance(index.governance),
        review_gates: normalizeReviewGates(index.reviewGates),
      };
      const current = documents.get(record.id);
      if (!current || (record.reviewed_at || record.created_at) >= (current.reviewed_at || current.created_at)) {
        documents.set(record.id, record);
      }
    }
  }

  return [...documents.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

export async function reviewKnowledgeDocument(
  id: string,
  status: "approved" | "rejected",
  note: string,
  reviewerEmail: string,
  reviewGates: ReviewGates,
) {
  const reviewedAt = Date.now();
  let changed = false;
  let firstError: unknown;

  if (googleDriveStatus().configured) {
    try {
      const indexes = await loadDriveKnowledgeIndexes();
      const index = indexes.find((candidate) =>
        candidate.knowledgeId === id && (!candidate.reviewStatus || candidate.reviewStatus === "pending")
      );
      if (index) {
        await updateDriveKnowledgeIndex({
          ...index,
          reviewStatus: status,
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
      DB.prepare(`UPDATE knowledge_documents SET status = ?
        WHERE id = ? AND status IN ('ready', 'pending')`).bind(status, id),
      DB.prepare(`INSERT INTO knowledge_governance (
          record_id, record_kind, review_gates, reviewer_email, review_note, reviewed_at, updated_at
        ) VALUES (?, 'document', ?, ?, ?, ?, ?)
        ON CONFLICT(record_id) DO UPDATE SET review_gates = excluded.review_gates,
          reviewer_email = excluded.reviewer_email, review_note = excluded.review_note,
          reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at`)
        .bind(id, JSON.stringify(reviewGates), reviewerEmail, note || null, reviewedAt, reviewedAt),
    ]);
    if (result.meta.changes) changed = true;
  } catch (error) {
    firstError ||= error;
  }

  if (!changed && firstError) throw firstError;
  return changed;
}

export async function deleteKnowledgeDocuments(ids: string[]) {
  const uniqueIds = [...new Set(ids)].slice(0, 100);
  let deleted = 0;
  let firstError: unknown;

  if (googleDriveStatus().configured) {
    try {
      deleted = Math.max(deleted, await deleteDriveKnowledgeDocuments(uniqueIds));
    } catch (error) {
      firstError = error;
    }
  }

  try {
    const DB = await ensureSchema();
    const objectKeys: string[] = [];
    for (const id of uniqueIds) {
      const row = await DB.prepare("SELECT object_key FROM knowledge_documents WHERE id = ?")
        .bind(id)
        .first<{ object_key: string }>();
      if (row?.object_key && !row.object_key.startsWith("gdrive:")) objectKeys.push(row.object_key);
    }
    const results = await DB.batch(uniqueIds.flatMap((id) => [
      DB.prepare("DELETE FROM knowledge_governance WHERE record_id = ? AND record_kind = 'document'").bind(id),
      DB.prepare("DELETE FROM knowledge_documents WHERE id = ?").bind(id),
    ]));
    const databaseDeleted = results
      .filter((_, index) => index % 2 === 1)
      .reduce((sum, result) => sum + (result.meta.changes || 0), 0);
    deleted = Math.max(deleted, databaseDeleted);
    const bucket = getPlatformEnv().KNOWLEDGE_FILES;
    if (bucket) {
      for (const key of objectKeys) await bucket.delete(key);
    }
  } catch (error) {
    firstError ||= error;
  }

  if (!deleted && firstError) throw firstError;
  return deleted;
}
