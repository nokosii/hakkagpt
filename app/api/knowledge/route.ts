import { ensureSchema, requestIdentity } from "@/db/runtime";

export const runtime = "edge";

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "-").replace(/^-|-$/g, "");
}

export async function GET() {
  const DB = await ensureSchema();
  const result = await DB.prepare(`SELECT id, term, slug, summary, content, source_url,
      status, author_email, review_note, created_at, reviewed_at
    FROM knowledge_revisions
    ORDER BY created_at DESC
    LIMIT 120`).all();
  return Response.json({ entries: result.results || [] });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      term?: string;
      summary?: string;
      content?: string;
      sourceUrl?: string;
    };
    const term = String(body.term || "").trim();
    const summary = String(body.summary || "").trim();
    const content = String(body.content || "").trim();
    const sourceUrl = String(body.sourceUrl || "").trim();
    if (term.length < 2 || term.length > 80) {
      return Response.json({ error: "詞條名稱需為 2 至 80 字" }, { status: 400 });
    }
    if (summary.length < 4 || summary.length > 240) {
      return Response.json({ error: "摘要需為 4 至 240 字" }, { status: 400 });
    }
    if (content.length < 10 || content.length > 12000) {
      return Response.json({ error: "詞條內容需為 10 至 12,000 字" }, { status: 400 });
    }
    if (sourceUrl) {
      try {
        const parsed = new URL(sourceUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        return Response.json({ error: "來源網址格式不正確" }, { status: 400 });
      }
    }

    const identity = requestIdentity(request);
    const DB = await ensureSchema();
    const id = crypto.randomUUID();
    await DB.prepare(`INSERT INTO knowledge_revisions (
      id, term, slug, summary, content, source_url, status,
      author_id, author_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .bind(
        id,
        term,
        slugify(term) || id,
        summary,
        content,
        sourceUrl || null,
        identity.id,
        identity.email,
        Date.now(),
      )
      .run();
    return Response.json({ id, status: "pending", activeInSearch: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "詞條送出失敗" }, { status: 500 });
  }
}
