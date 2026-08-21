import { requireAdmin } from "@/lib/admin-auth";
import { deleteKnowledgeDocuments, listKnowledgeDocuments } from "@/lib/knowledge-documents";

export const runtime = "edge";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  return Response.json({ documents: await listKnowledgeDocuments(1000) });
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!ids.length || ids.length > 100) {
      return Response.json({ error: "請選擇 1 至 100 份文件" }, { status: 400 });
    }
    const allowed = new Set((await listKnowledgeDocuments(5000)).map((document) => document.id));
    const safeIds = ids.filter((id) => allowed.has(id));
    if (!safeIds.length) return Response.json({ error: "找不到可刪除的文件" }, { status: 404 });
    return Response.json({ deleted: await deleteKnowledgeDocuments(safeIds) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "文件刪除失敗" }, { status: 500 });
  }
}
