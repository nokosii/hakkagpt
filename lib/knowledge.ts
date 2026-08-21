import { ensureSchema } from "@/db/runtime";
import {
  ACCESS_LABELS,
  allReviewGatesPassed,
  defaultGovernance,
  governanceFromRow,
  normalizeGovernance,
  normalizeReviewGates,
  type DialectTag,
  type GovernanceMetadata,
} from "@/lib/governance";
import { loadDriveKnowledgeEntries, loadDriveKnowledgeIndexes } from "@/lib/google-drive";

export type KnowledgeSource = {
  id: string;
  title: string;
  kind: "entry" | "document";
  status: "pending" | "approved" | "ready";
  excerpt: string;
  sourceUrl?: string | null;
  score: number;
  dialect: DialectTag;
  rightsHolder: string;
  rightsBasis: string;
  license: string;
  accessLevel: "public" | "community" | "restricted";
  communityBenefit: string;
};

type RevisionRow = {
  id: string;
  term: string;
  slug: string;
  summary: string;
  content: string;
  source_url: string | null;
  status: "pending" | "approved";
  created_at: number;
  dialect: string | null;
  rights_holder: string | null;
  rights_basis: string | null;
  license: string | null;
  access_level: string | null;
  community_benefit: string | null;
  consent_confirmed: number | null;
};

type ChunkRow = {
  id: string;
  file_name: string;
  content: string;
  created_at: number;
  dialect: string | null;
  rights_holder: string | null;
  rights_basis: string | null;
  license: string | null;
  access_level: string | null;
  community_benefit: string | null;
  consent_confirmed: number | null;
  review_gates_json: string | null;
};

function tokensFor(value: string): string[] {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  const words = value.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  const grams: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const gram = normalized.slice(index, index + 2);
    if (/[^\p{P}\p{S}]/u.test(gram)) grams.push(gram);
  }
  return [...new Set([...words, ...grams])].slice(0, 48);
}

function relevance(question: string, title: string, content: string): number {
  const q = question.toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const haystack = `${title}\n${content}`.toLowerCase();
  let score = q.includes(normalizedTitle) || normalizedTitle.includes(q) ? 24 : 0;
  for (const token of tokensFor(question)) {
    if (normalizedTitle.includes(token)) score += 5;
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function dialectScore(sourceDialect: DialectTag, selectedDialect?: DialectTag) {
  if (!selectedDialect || selectedDialect === "未標示") return 0;
  if (sourceDialect === selectedDialect) return 14;
  if (sourceDialect === "未標示") return 0;
  return -4;
}

function toSource(args: {
  id: string;
  title: string;
  kind: "entry" | "document";
  status: "pending" | "approved" | "ready";
  excerpt: string;
  sourceUrl?: string | null;
  baseScore: number;
  governance: GovernanceMetadata;
  selectedDialect?: DialectTag;
}): KnowledgeSource {
  return {
    id: args.id,
    title: args.title,
    kind: args.kind,
    status: args.status,
    excerpt: args.excerpt,
    sourceUrl: args.sourceUrl,
    score: args.baseScore + dialectScore(args.governance.dialect, args.selectedDialect),
    dialect: args.governance.dialect,
    rightsHolder: args.governance.rightsHolder,
    rightsBasis: args.governance.rightsBasis,
    license: args.governance.license,
    accessLevel: args.governance.accessLevel,
    communityBenefit: args.governance.communityBenefit,
  };
}

function parseGates(value: string | null) {
  if (!value) return normalizeReviewGates(null);
  try {
    return normalizeReviewGates(JSON.parse(value));
  } catch {
    return normalizeReviewGates(null);
  }
}

export async function retrieveKnowledge(question: string, selectedDialect?: DialectTag) {
  const chosenBySlug = new Map<string, { row: RevisionRow; governance: GovernanceMetadata }>();
  const databaseChunks: Array<ChunkRow & { governance: GovernanceMetadata }> = [];
  try {
    const DB = await ensureSchema();
    const revisionsResult = await DB.prepare(`SELECT r.id, r.term, r.slug, r.summary, r.content,
        r.source_url, r.status, r.created_at, g.dialect, g.rights_holder, g.rights_basis,
        g.license, g.access_level, g.community_benefit, g.consent_confirmed
      FROM knowledge_revisions r
      LEFT JOIN knowledge_governance g ON g.record_id = r.id AND g.record_kind = 'entry'
      WHERE r.status IN ('pending', 'approved')
        AND COALESCE(g.access_level, 'public') = 'public'
        AND g.withdrawn_at IS NULL
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT 200`).all<RevisionRow>();
    for (const row of revisionsResult.results || []) {
      if (!chosenBySlug.has(row.slug)) {
        chosenBySlug.set(row.slug, {
          row,
          governance: governanceFromRow(row as unknown as Record<string, unknown>),
        });
      }
    }

    const chunkResult = await DB.prepare(`SELECT c.id, d.file_name, c.content, c.created_at,
        g.dialect, g.rights_holder, g.rights_basis, g.license, g.access_level,
        g.community_benefit, g.consent_confirmed, g.review_gates AS review_gates_json
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      LEFT JOIN knowledge_governance g ON g.record_id = d.id AND g.record_kind = 'document'
      WHERE d.status IN ('ready', 'pending', 'approved')
        AND COALESCE(g.access_level, 'public') = 'public'
        AND g.withdrawn_at IS NULL
      ORDER BY c.created_at DESC
      LIMIT 320`).all<ChunkRow>();
    for (const row of chunkResult.results || []) {
      databaseChunks.push({
        ...row,
        governance: governanceFromRow(row as unknown as Record<string, unknown>),
      });
    }
  } catch {
    // Render 可直接從 Google Drive 索引取得內容，D1 不可用時不阻斷查詢。
  }

  try {
    const driveEntries = (await loadDriveKnowledgeEntries())
      .filter((entry) =>
        (entry.status === "pending" || entry.status === "approved") &&
        normalizeGovernance(entry.governance).accessLevel === "public"
      )
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
    for (const entry of driveEntries) {
      const current = chosenBySlug.get(entry.slug);
      if (
        !current ||
        (entry.status === "pending" && current.row.status !== "pending") ||
        (entry.status === current.row.status && entry.createdAt > current.row.created_at)
      ) {
        chosenBySlug.set(entry.slug, {
          row: {
            id: entry.id,
            term: entry.term,
            slug: entry.slug,
            summary: entry.summary,
            content: entry.content,
            source_url: entry.sourceUrl,
            status: entry.status,
            created_at: entry.createdAt,
            dialect: entry.governance.dialect,
            rights_holder: entry.governance.rightsHolder,
            rights_basis: entry.governance.rightsBasis,
            license: entry.governance.license,
            access_level: entry.governance.accessLevel,
            community_benefit: entry.governance.communityBenefit,
            consent_confirmed: entry.governance.consentConfirmed ? 1 : 0,
          },
          governance: normalizeGovernance(entry.governance),
        });
      }
    }
  } catch {
    // Drive 暫時無法讀取時，仍可使用 D1 既有詞條。
  }

  const revisionSources = [...chosenBySlug.values()].map(({ row, governance }) => toSource({
    id: row.id,
    title: row.term,
    kind: "entry",
    status: row.status,
    excerpt: `${row.summary}\n${row.content}`,
    sourceUrl: row.source_url,
    baseScore: relevance(question, row.term, `${row.summary}\n${row.content}`) +
      (row.status === "pending" ? 2 : 0),
    governance,
    selectedDialect,
  }));

  const chunkSources = databaseChunks.map((row) => toSource({
    id: row.id,
    title: row.file_name,
    kind: "document",
    status: allReviewGatesPassed(parseGates(row.review_gates_json)) ? "approved" : "pending",
    excerpt: row.content,
    baseScore: relevance(question, row.file_name, row.content),
    governance: row.governance,
    selectedDialect,
  }));

  try {
    const driveIndexes = await loadDriveKnowledgeIndexes();
    for (const index of driveIndexes) {
      const governance = normalizeGovernance(index.governance || defaultGovernance());
      if (governance.accessLevel !== "public" || index.reviewStatus === "rejected") continue;
      index.chunks.forEach((content, chunkIndex) => {
        chunkSources.push(toSource({
          id: `drive-${index.knowledgeId}-${chunkIndex}`,
          title: index.fileName,
          kind: "document",
          status: index.reviewStatus === "approved" ? "approved" : "pending",
          excerpt: content,
          baseScore: relevance(question, index.fileName, content),
          governance,
          selectedDialect,
        }));
      });
    }
  } catch {
    // Drive 暫時無法讀取時，仍可使用共編詞條與 D1 既有片段。
  }

  const uniqueSources = new Map<string, KnowledgeSource>();
  for (const source of [...revisionSources, ...chunkSources]) {
    const key = `${source.kind}\u0000${source.title}\u0000${source.excerpt}`;
    const current = uniqueSources.get(key);
    if (!current || source.score > current.score) uniqueSources.set(key, source);
  }

  const sources = [...uniqueSources.values()]
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const context = sources
    .map((source, index) => {
      const status = source.status === "pending" ? "暫行內容，尚未通過雙閘門" : "已審核或正式匯入";
      const sourceLink = source.sourceUrl ? `｜原始來源 ${source.sourceUrl}` : "";
      return `[資料 ${index + 1}｜${source.title}｜${status}｜腔別 ${source.dialect}｜權利持有人 ${source.rightsHolder}｜權利依據 ${source.rightsBasis}｜授權 ${source.license}｜${ACCESS_LABELS[source.accessLevel]}${sourceLink}]\n${source.excerpt.slice(0, 2200)}`;
    })
    .join("\n\n")
    .slice(0, 11_000);

  return {
    sources,
    context,
    evidenceState: sources.length ? "grounded" as const : "model-only" as const,
  };
}
