import { ensureSchema } from "@/db/runtime";
import { loadDriveKnowledgeEntries, loadDriveKnowledgeIndexes } from "@/lib/google-drive";

export type KnowledgeSource = {
  id: string;
  title: string;
  kind: "entry" | "document";
  status: "pending" | "approved" | "ready";
  excerpt: string;
  sourceUrl?: string | null;
  score: number;
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
};

type ChunkRow = {
  id: string;
  file_name: string;
  content: string;
  created_at: number;
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
  const haystack = `${title}\n${content}`.toLowerCase();
  let score = q.includes(title.toLowerCase()) || title.toLowerCase().includes(q) ? 24 : 0;
  for (const token of tokensFor(question)) {
    if (title.toLowerCase().includes(token)) score += 5;
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

export async function retrieveKnowledge(question: string) {
  const chosenBySlug = new Map<string, RevisionRow>();
  const databaseChunks: ChunkRow[] = [];
  try {
    const DB = await ensureSchema();
    const revisionsResult = await DB.prepare(`SELECT id, term, slug, summary, content,
        source_url, status, created_at
      FROM knowledge_revisions
      WHERE status IN ('pending', 'approved')
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 160`).all<RevisionRow>();
    for (const row of revisionsResult.results || []) {
      if (!chosenBySlug.has(row.slug)) chosenBySlug.set(row.slug, row);
    }

    const chunkResult = await DB.prepare(`SELECT c.id, d.file_name, c.content, c.created_at
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE d.status = 'ready'
      ORDER BY c.created_at DESC
      LIMIT 240`).all<ChunkRow>();
    databaseChunks.push(...(chunkResult.results || []));
  } catch {
    // Render 可直接從 Google Drive 索引取得文件內容，D1 不可用時不阻斷查詢。
  }

  try {
    const driveEntries = (await loadDriveKnowledgeEntries())
      .filter((entry) => entry.status === "pending" || entry.status === "approved")
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
        return b.createdAt - a.createdAt;
    });
    for (const entry of driveEntries) {
      const current = chosenBySlug.get(entry.slug);
      if (
        !current ||
        (entry.status === "pending" && current.status !== "pending") ||
        (entry.status === current.status && entry.createdAt > current.created_at)
      ) {
        chosenBySlug.set(entry.slug, {
          id: entry.id,
          term: entry.term,
          slug: entry.slug,
          summary: entry.summary,
          content: entry.content,
          source_url: entry.sourceUrl,
          status: entry.status,
          created_at: entry.createdAt,
        });
      }
    }
  } catch {
    // Drive 暫時無法讀取時，仍可使用 D1 既有詞條。
  }

  const revisionSources: KnowledgeSource[] = [...chosenBySlug.values()].map((row) => ({
    id: row.id,
    title: row.term,
    kind: "entry",
    status: row.status,
    excerpt: `${row.summary}\n${row.content}`,
    sourceUrl: row.source_url,
    score: relevance(question, row.term, `${row.summary}\n${row.content}`) +
      (row.status === "pending" ? 2 : 0),
  }));

  const chunkSources: KnowledgeSource[] = databaseChunks.map((row) => ({
    id: row.id,
    title: row.file_name,
    kind: "document",
    status: "ready",
    excerpt: row.content,
    score: relevance(question, row.file_name, row.content),
  }));

  try {
    const driveIndexes = await loadDriveKnowledgeIndexes();
    for (const index of driveIndexes) {
      index.chunks.forEach((content, chunkIndex) => {
        chunkSources.push({
          id: `drive-${index.knowledgeId}-${chunkIndex}`,
          title: index.fileName,
          kind: "document",
          status: "ready",
          excerpt: content,
          score: relevance(question, index.fileName, content),
        });
      });
    }
  } catch {
    // Drive 暫時無法讀取時，仍可使用共編詞條與 D1 既有片段。
  }

  const uniqueSources = new Map<string, KnowledgeSource>();
  for (const source of [...revisionSources, ...chunkSources]) {
    const key = `${source.kind}\u0000${source.title}\u0000${source.excerpt}`;
    if (!uniqueSources.has(key)) uniqueSources.set(key, source);
  }

  const ranked = [...uniqueSources.values()]
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const fallback = revisionSources
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const sources = ranked.length ? ranked : fallback;
  const context = sources
    .map((source, index) => {
      const status = source.status === "pending" ? "共編待審（優先採用）" : "已審核／已匯入";
      return `[資料 ${index + 1}｜${source.title}｜${status}]\n${source.excerpt.slice(0, 2200)}`;
    })
    .join("\n\n")
    .slice(0, 9000);

  return { sources, context };
}
