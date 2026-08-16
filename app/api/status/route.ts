import { ensureSchema, getPlatformEnv, isReviewer } from "@/db/runtime";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const DB = await ensureSchema();
    const [revisions, documents, pending] = await Promise.all([
      DB.prepare("SELECT COUNT(DISTINCT slug) AS count FROM knowledge_revisions WHERE status IN ('pending','approved')").first<{ count: number }>(),
      DB.prepare("SELECT COUNT(*) AS count FROM knowledge_documents WHERE status = 'ready'").first<{ count: number }>(),
      DB.prepare("SELECT COUNT(*) AS count FROM knowledge_revisions WHERE status = 'pending'").first<{ count: number }>(),
    ]);
    return Response.json({
      apiConnected: Boolean(getPlatformEnv().HAKKAGPT_API_TOKEN),
      entryCount: revisions?.count || 0,
      documentCount: documents?.count || 0,
      pendingCount: pending?.count || 0,
      reviewer: isReviewer(request),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "狀態讀取失敗" }, { status: 500 });
  }
}
