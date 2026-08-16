export type PlatformEnv = {
  DB: D1Database;
  KNOWLEDGE_FILES: R2Bucket;
  HAKKAGPT_API_TOKEN?: string;
  HAKKAGPT_ENDPOINT?: string;
  HAKKAGPT_AGENT_ID?: string;
  HAKKAGPT_USER_ID?: string;
  REVIEWER_EMAILS?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
};

let schemaReady = false;
let workerBindings: Partial<PlatformEnv> = {};

try {
  const workerRuntime = await import("cloudflare:workers");
  workerBindings = workerRuntime.env as unknown as Partial<PlatformEnv>;
} catch {
  // Render 使用 Node.js 環境變數，不提供 cloudflare:workers 模組。
}

export function getPlatformEnv(): PlatformEnv {
  const nodeEnvironment =
    typeof process !== "undefined" ? process.env as Record<string, string | undefined> : {};
  return { ...nodeEnvironment, ...workerBindings } as unknown as PlatformEnv;
}

export async function ensureSchema(): Promise<D1Database> {
  const { DB } = getPlatformEnv();
  if (!DB) throw new Error("知識資料庫尚未連線");
  if (schemaReady) return DB;

  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS knowledge_revisions (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL,
      slug TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      source_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      author_id TEXT NOT NULL,
      author_email TEXT NOT NULL,
      reviewer_email TEXT,
      review_note TEXT,
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_revisions_slug_status_created
      ON knowledge_revisions(slug, status, created_at)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_revisions_status_created
      ON knowledge_revisions(status, created_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      object_key TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      page_count INTEGER,
      row_count INTEGER,
      chunk_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      owner_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_documents_created
      ON knowledge_documents(created_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_chunks_document_index
      ON knowledge_chunks(document_id, chunk_index)`),
  ]);

  const count = await DB.prepare(
    "SELECT COUNT(*) AS count FROM knowledge_revisions",
  ).first<{ count: number }>();
  if (!count?.count) {
    const now = Date.now();
    const seeds = [
      {
        term: "天穿日",
        slug: "天穿日",
        summary: "客家重要歲時節慶，傳說為女媧補天之日。",
        content:
          "天穿日多在農曆正月二十。客庄過去有歇工、敬天與惜福的習俗，也常以客家山歌、盤花與米食活動延續節慶記憶。",
        source: "https://www.hakka.gov.tw/",
      },
      {
        term: "義民信仰",
        slug: "義民信仰",
        summary: "臺灣客庄重要的地方信仰與集體記憶。",
        content:
          "義民信仰源於保鄉衛土的歷史記憶，透過義民祭典、輪值祭典與地方組織，凝聚不同客庄的社群認同。",
        source: "https://cloud.hakka.gov.tw/",
      },
      {
        term: "擂茶",
        slug: "擂茶",
        summary: "以茶葉、芝麻、花生等材料擂磨沖泡的飲食文化。",
        content:
          "擂茶的材料與吃法因地而異。製作時將茶葉、芝麻、花生等食材在擂缽中磨成細末，再以熱水沖泡；現代也常成為客庄文化體驗。",
        source: "https://www.hakka.gov.tw/",
      },
    ];
    await DB.batch(
      seeds.map((item, index) =>
        DB.prepare(`INSERT INTO knowledge_revisions (
          id, term, slug, summary, content, source_url, status,
          author_id, author_email, reviewer_email, review_note, created_at, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'approved', 'system', 'system@ketiengong.tw',
          'system@ketiengong.tw', '初始公開知識', ?, ?)`)
          .bind(
            `seed-${index + 1}`,
            item.term,
            item.slug,
            item.summary,
            item.content,
            item.source,
            now + index,
            now + index,
          ),
      ),
    );
  }

  await DB.prepare("PRAGMA optimize").run();
  schemaReady = true;
  return DB;
}

export function requestIdentity(request: Request) {
  const url = new URL(request.url);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return {
    id: request.headers.get("oai-authenticated-user-id") || (local ? "local-preview" : "anonymous"),
    email:
      request.headers.get("oai-authenticated-user-email") ||
      (local ? "preview@ketiengong.local" : "anonymous@ketiengong.tw"),
    local,
  };
}

export function isReviewer(request: Request): boolean {
  const identity = requestIdentity(request);
  if (identity.local) return true;
  const allowlist = (getPlatformEnv().REVIEWER_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.length) return identity.id !== "anonymous";
  return allowlist.includes(identity.email.toLowerCase());
}
