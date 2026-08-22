import { ensureSchema, getPlatformEnv } from "@/db/runtime";
import { adminStatus, isAdminRequest } from "@/lib/admin-auth";
import {
  countDriveKnowledgeDocuments,
  googleDriveStatus,
  loadDriveKnowledgeEntries,
  loadDriveKnowledgeIndexes,
} from "@/lib/google-drive";
import { DIALECTS, normalizeGovernance } from "@/lib/governance";

export const runtime = "edge";

export async function GET(request: Request) {
  const platformEnv = getPlatformEnv();
  const drive = googleDriveStatus(platformEnv);
  let entryCount = 0;
  let localDocumentCount = 0;
  let pendingCount = 0;
  let databaseConnected = false;
  const dialectIds = new Map(DIALECTS.map((dialect) => [dialect, new Set<string>()]));
  const accessIds = new Map(["public", "community", "restricted"].map((level) => [level, new Set<string>()]));
  try {
    const DB = await ensureSchema();
    const [revisions, documents, pendingEntries, pendingDocuments] = await Promise.all([
      DB.prepare("SELECT COUNT(DISTINCT slug) AS count FROM knowledge_revisions WHERE status IN ('pending','approved')").first<{ count: number }>(),
      DB.prepare("SELECT COUNT(*) AS count FROM knowledge_documents WHERE status IN ('ready','pending','approved')").first<{ count: number }>(),
      DB.prepare("SELECT COUNT(*) AS count FROM knowledge_revisions WHERE status = 'pending'").first<{ count: number }>(),
      DB.prepare("SELECT COUNT(*) AS count FROM knowledge_documents WHERE status IN ('ready','pending')").first<{ count: number }>(),
    ]);
    entryCount = revisions?.count || 0;
    localDocumentCount = documents?.count || 0;
    pendingCount = (pendingEntries?.count || 0) + (pendingDocuments?.count || 0);
    databaseConnected = true;
    const governance = await DB.prepare(`SELECT record_id, dialect, access_level
      FROM knowledge_governance WHERE withdrawn_at IS NULL`).all<{
        record_id: string;
        dialect: typeof DIALECTS[number];
        access_level: "public" | "community" | "restricted";
      }>();
    for (const row of governance.results || []) {
      dialectIds.get(row.dialect)?.add(row.record_id);
      accessIds.get(row.access_level)?.add(row.record_id);
    }
  } catch {
    // Render 未接 D1 時仍可透過 Google Drive 運作檔案匯入與檢索。
  }
  let driveDocumentCount = 0;
  let driveReachable = false;
  if (drive.configured) {
    try {
      const [documentCount, driveEntries, driveIndexes] = await Promise.all([
        countDriveKnowledgeDocuments(),
        loadDriveKnowledgeEntries(),
        loadDriveKnowledgeIndexes(),
      ]);
      driveDocumentCount = documentCount;
      const activeSlugs = new Set(
        driveEntries
          .filter((entry) => entry.status === "pending" || entry.status === "approved")
          .map((entry) => entry.slug),
      );
      entryCount = Math.max(entryCount, activeSlugs.size);
      pendingCount = Math.max(
        pendingCount,
        driveEntries.filter((entry) => entry.status === "pending").length +
          driveIndexes.filter((index) => !index.reviewStatus || index.reviewStatus === "pending").length,
      );
      for (const item of [...driveEntries, ...driveIndexes]) {
        const recordId = "id" in item ? item.id : item.knowledgeId;
        const governance = normalizeGovernance(item.governance);
        dialectIds.get(governance.dialect)?.add(recordId);
        accessIds.get(governance.accessLevel)?.add(recordId);
      }
      driveReachable = true;
    } catch {
      // 狀態列不應因 Drive 暫時無法列出檔案而整體失效。
    }
  }
  const r2Connected = Boolean(platformEnv.KNOWLEDGE_FILES);
  return Response.json({
    apiConnected: Boolean(platformEnv.HAKKAGPT_API_TOKEN),
    graphEnabled: true,
    entryCount,
    documentCount: Math.max(localDocumentCount, driveDocumentCount),
    pendingCount,
    reviewer: await isAdminRequest(request),
    adminConfigured: adminStatus().configured,
    databaseConnected,
    storageConnected: driveReachable || r2Connected,
    storageLabel: drive.configured
      ? driveReachable ? "Google Drive" : "Google Drive 待驗證"
      : r2Connected ? "Cloudflare R2" : "尚未連線",
    googleDriveConnected: driveReachable,
    googleDriveMissing: drive.missing,
    dialectCoverage: Object.fromEntries([...dialectIds].map(([key, ids]) => [key, ids.size])),
    accessCounts: Object.fromEntries([...accessIds].map(([key, ids]) => [key, ids.size])),
  });
}
