import { requireAdmin } from "@/lib/admin-auth";
import { deleteKnowledgeEntries, listKnowledgeEntries } from "@/lib/knowledge-entries";

export const runtime = "edge";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const entries = (await listKnowledgeEntries(2000)).filter((entry) => entry.author_id !== "system");
  return Response.json({ entries });
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!ids.length || ids.length > 200) {
      return Response.json({ error: "請選擇 1 至 200 筆資料" }, { status: 400 });
    }
    const allowed = new Set(
      (await listKnowledgeEntries(5000))
        .filter((entry) => entry.author_id !== "system")
        .map((entry) => entry.id),
    );
    const safeIds = ids.filter((id) => allowed.has(id));
    if (!safeIds.length) return Response.json({ error: "找不到可刪除的資料" }, { status: 404 });
    const deleted = await deleteKnowledgeEntries(safeIds);
    return Response.json({ deleted });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "資料刪除失敗" }, { status: 500 });
  }
}
