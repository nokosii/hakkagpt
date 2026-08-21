import { isAdminRequest, requireAdmin } from "@/lib/admin-auth";
import { listKnowledgeEntries, reviewKnowledgeEntry } from "@/lib/knowledge-entries";
import { allReviewGatesPassed, normalizeReviewGates } from "@/lib/governance";
import { reviewKnowledgeDocument } from "@/lib/knowledge-documents";

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
    const body = (await request.json()) as { id?: string; kind?: string; action?: string; note?: string; gates?: unknown };
    const id = String(body.id || "").trim();
    const action = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "";
    const note = String(body.note || "").trim().slice(0, 500);
    const gates = normalizeReviewGates(body.gates);
    if (!id || !action) return Response.json({ error: "審查動作不正確" }, { status: 400 });
    if (action === "approved" && !allReviewGatesPassed(gates)) {
      return Response.json({ error: "通過前必須完成技術適切性與文化安全的全部檢核" }, { status: 400 });
    }
    const kind = body.kind === "document" ? "document" : "entry";
    const changed = kind === "document"
      ? await reviewKnowledgeDocument(id, action, note, "admin@ketiengong.tw", gates)
      : await reviewKnowledgeEntry(id, action, note, "admin@ketiengong.tw", gates);
    if (!changed) return Response.json({ error: kind === "document" ? "找不到待審文件" : "找不到待審詞條" }, { status: 404 });
    return Response.json({ id, kind, status: action });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "審查更新失敗" }, { status: 500 });
  }
}
