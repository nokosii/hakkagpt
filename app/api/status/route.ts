import { ensureSchema, getPlatformEnv, isReviewer } from "@/db/runtime";
import { countDriveKnowledgeDocuments, googleDriveStatus } from "@/lib/google-drive";

export const runtime = "edge";

export async function GET(request: Request) {
  const platformEnv = getPlatformEnv();
  const drive = googleDriveStatus(platformEnv);
  let entryCount = 0;
  let localDocumentCount = 0;
  let pendingCount = 0;
  let databaseConnected = false;
  try {
    const DB = await ensureSchema();
    const [revisions, documents, pending] = await Promise.all([
      DB.prepare("SELECT COUNT(DISTINCT slug) AS count FROM knowledge_revisions WHERE status IN ('pending','approved')").first<{ count: number }>(),
      DB.prepare("SELECT COUNT(*) AS count FROM knowledge_documents WHERE status = 'ready'").first<{ count: number }>(),
      DB.prepare("SELECT COUNT(*) AS count FROM knowledge_revisions WHERE status = 'pending'").first<{ count: number }>(),
    ]);
    entryCount = revisions?.count || 0;
    localDocumentCount = documents?.count || 0;
    pendingCount = pending?.count || 0;
    databaseConnected = true;
  } catch {
    // Render 未接 D1 時仍可透過 Google Drive 運作檔案匯入與檢索。
  }
  let driveDocumentCount = 0;
  let driveReachable = false;
  if (drive.configured) {
    try {
      driveDocumentCount = await countDriveKnowledgeDocuments();
      driveReachable = true;
    } catch {
      // 狀態列不應因 Drive 暫時無法列出檔案而整體失效。
    }
  }
  const r2Connected = Boolean(platformEnv.KNOWLEDGE_FILES);
  return Response.json({
    apiConnected: Boolean(platformEnv.HAKKAGPT_API_TOKEN),
    entryCount,
    documentCount: Math.max(localDocumentCount, driveDocumentCount),
    pendingCount,
    reviewer: databaseConnected && isReviewer(request),
    databaseConnected,
    storageConnected: driveReachable || r2Connected,
    storageLabel: drive.configured
      ? driveReachable ? "Google Drive" : "Google Drive 待驗證"
      : r2Connected ? "Cloudflare R2" : "尚未連線",
    googleDriveConnected: driveReachable,
    googleDriveMissing: drive.missing,
  });
}
