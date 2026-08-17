import { isAdminRequest, requireAdmin } from "@/lib/admin-auth";
import { listKnowledgeEntries, reviewKnowledgeEntry } from "@/lib/knowledge-entries";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return Response.json({ entries: [], reviewer: false });
  }
  const entries = (await listKnowledgeEntries(500))
    .filter((entry) => entry.status === "pending")
    .sort((a, b) => a.created_at - b.created_at)
    .slice(0, 200);
  return Response.json({ entries, reviewer: true });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = (await request.json()) as { id?: string; action?: string; note?: string };
    const id = String(body.id || "").trim();
    const action = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "";
    const note = String(body.note || "").trim().slice(0, 500);
    if (!id || !action) return Response.json({ error: "審查動作不正確" }, { status: 400 });
    const changed = await reviewKnowledgeEntry(id, action, note, "admin@ketiengong.tw");
    if (!changed) return Response.json({ error: "找不到待審詞條" }, { status: 404 });
    return Response.json({ id, status: action });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "審查更新失敗" }, { status: 500 });
  }
}
