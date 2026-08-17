import { requestIdentity } from "@/db/runtime";
import { createKnowledgeEntry, listKnowledgeEntries } from "@/lib/knowledge-entries";

export const runtime = "edge";

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "-").replace(/^-|-$/g, "");
}

export async function GET() {
  return Response.json({ entries: await listKnowledgeEntries(120) });
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
    const id = crypto.randomUUID();
    await createKnowledgeEntry({
      id,
      term,
      slug: slugify(term) || id,
      summary,
      content,
      source_url: sourceUrl || null,
      status: "pending",
      author_id: identity.id,
      author_email: identity.email,
      reviewer_email: null,
      review_note: null,
      created_at: Date.now(),
      reviewed_at: null,
    });
    return Response.json({ id, status: "pending", activeInSearch: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "詞條送出失敗" }, { status: 500 });
  }
}
