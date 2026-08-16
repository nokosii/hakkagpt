import { ensureSchema, isReviewer, requestIdentity } from "@/db/runtime";

export const runtime = "edge";

export async function GET(request: Request) {
  const DB = await ensureSchema();
  const result = await DB.prepare(`SELECT id, term, summary, content, source_url,
      author_email, created_at
    FROM knowledge_revisions
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 80`).all();
  return Response.json({ entries: result.results || [], reviewer: isReviewer(request) });
}

export async function POST(request: Request) {
  if (!isReviewer(request)) {
    return Response.json({ error: "此帳號沒有審查權限" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { id?: string; action?: string; note?: string };
    const id = String(body.id || "").trim();
    const action = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "";
    const note = String(body.note || "").trim().slice(0, 500);
    if (!id || !action) return Response.json({ error: "審查動作不正確" }, { status: 400 });
    const identity = requestIdentity(request);
    const DB = await ensureSchema();
    const result = await DB.prepare(`UPDATE knowledge_revisions
      SET status = ?, reviewer_email = ?, review_note = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending'`)
      .bind(action, identity.email, note || null, Date.now(), id)
      .run();
    if (!result.meta.changes) return Response.json({ error: "找不到待審詞條" }, { status: 404 });
    return Response.json({ id, status: action });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "審查更新失敗" }, { status: 500 });
  }
}
