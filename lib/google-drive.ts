import { getPlatformEnv, type PlatformEnv } from "@/db/runtime";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const INDEX_KIND = "ketiengong-rag-index";
const ENTRY_KIND = "ketiengong-knowledge-entry";
const DEFAULT_FOLDER_ID = "1AQ8NQBgruJlb6bYQMVUOPvJPZ0olKFUd";

export type DriveKnowledgeIndex = {
  version: 1;
  knowledgeId: string;
  originalFileId: string;
  fileName: string;
  fileType: "csv" | "pdf";
  byteSize: number;
  pageCount: number | null;
  rowCount: number | null;
  createdAt: number;
  chunks: string[];
};

export type DriveKnowledgeEntry = {
  version: 1;
  id: string;
  term: string;
  slug: string;
  summary: string;
  content: string;
  sourceUrl: string | null;
  status: "pending" | "approved" | "rejected";
  authorId: string;
  authorEmail: string;
  reviewerEmail: string | null;
  reviewNote: string | null;
  createdAt: number;
  reviewedAt: number | null;
};

export type DriveKnowledgeEntryRecord = DriveKnowledgeEntry & {
  driveFileId: string;
};

type DriveFile = {
  id: string;
  name: string;
  createdTime?: string;
  webViewLink?: string;
};

type DriveFileList = {
  files?: DriveFile[];
  nextPageToken?: string;
};

let accessTokenCache: { token: string; expiresAt: number } | null = null;
let indexCache: { indexes: DriveKnowledgeIndex[]; expiresAt: number } | null = null;
let entryCache: { entries: DriveKnowledgeEntryRecord[]; expiresAt: number } | null = null;

function driveEnv(platformEnv: PlatformEnv = getPlatformEnv()) {
  return {
    folderId: platformEnv.GOOGLE_DRIVE_FOLDER_ID?.trim() || DEFAULT_FOLDER_ID,
    clientId: platformEnv.GOOGLE_DRIVE_CLIENT_ID?.trim() || "",
    clientSecret: platformEnv.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || "",
    refreshToken: platformEnv.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() || "",
  };
}

export function googleDriveStatus(platformEnv: PlatformEnv = getPlatformEnv()) {
  const configuration = driveEnv(platformEnv);
  const missing: string[] = [];
  if (!configuration.folderId) missing.push("GOOGLE_DRIVE_FOLDER_ID");
  if (!configuration.clientId) missing.push("GOOGLE_DRIVE_CLIENT_ID");
  if (!configuration.clientSecret) missing.push("GOOGLE_DRIVE_CLIENT_SECRET");
  if (!configuration.refreshToken) missing.push("GOOGLE_DRIVE_REFRESH_TOKEN");
  return { configured: missing.length === 0, missing };
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as {
      error?: string | { message?: string };
      error_description?: string;
    };
    if (typeof data.error === "string") return data.error_description || data.error;
    return data.error?.message || fallback;
  } catch {
    return fallback;
  }
}

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const configuration = driveEnv();
  const state = googleDriveStatus();
  if (!state.configured) {
    throw new Error(`Google Drive 尚未完成設定：${state.missing.join("、")}`);
  }

  const body = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    refresh_token: configuration.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(await responseMessage(response, "Google Drive 授權失敗"));
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google Drive 沒有回傳存取權杖");
  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in || 3600) * 1000,
  };
  return accessTokenCache.token;
}

async function authorizedFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 && retry) {
    accessTokenCache = null;
    await getAccessToken(true);
    return authorizedFetch(url, init, false);
  }
  return response;
}

async function resumableUpload(args: {
  name: string;
  mimeType: string;
  data: Blob;
  knowledgeId: string;
  kind: "original" | "index" | "entry";
}) {
  const { folderId } = driveEnv();
  const metadata = {
    name: args.name,
    parents: [folderId],
    appProperties: {
      ketiengongType:
        args.kind === "index" ? INDEX_KIND
          : args.kind === "entry" ? ENTRY_KIND
            : "ketiengong-original",
      knowledgeId: args.knowledgeId,
    },
  };
  const start = await authorizedFetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": args.mimeType,
        "X-Upload-Content-Length": String(args.data.size),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!start.ok) {
    throw new Error(await responseMessage(start, "無法在指定的 Google Drive 資料夾建立檔案"));
  }
  const uploadUrl = start.headers.get("Location");
  if (!uploadUrl) throw new Error("Google Drive 沒有回傳上傳位置");

  const uploaded = await authorizedFetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": args.mimeType },
    body: args.data,
  });
  if (!uploaded.ok) {
    throw new Error(await responseMessage(uploaded, "Google Drive 檔案上傳失敗"));
  }
  return (await uploaded.json()) as DriveFile;
}

export async function uploadKnowledgeToDrive(args: {
  id: string;
  fileName: string;
  fileType: "csv" | "pdf";
  mimeType: string;
  buffer: ArrayBuffer;
  pageCount: number | null;
  rowCount: number | null;
  chunks: string[];
}) {
  const original = await resumableUpload({
    name: args.fileName,
    mimeType: args.mimeType,
    data: new Blob([args.buffer], { type: args.mimeType }),
    knowledgeId: args.id,
    kind: "original",
  });

  const index: DriveKnowledgeIndex = {
    version: 1,
    knowledgeId: args.id,
    originalFileId: original.id,
    fileName: args.fileName,
    fileType: args.fileType,
    byteSize: args.buffer.byteLength,
    pageCount: args.pageCount,
    rowCount: args.rowCount,
    createdAt: Date.now(),
    chunks: args.chunks,
  };
  const indexBlob = new Blob([JSON.stringify(index)], { type: "application/json" });
  const sidecar = await resumableUpload({
    name: `.ketiengong-index-${args.id}.json`,
    mimeType: "application/json",
    data: indexBlob,
    knowledgeId: args.id,
    kind: "index",
  });
  indexCache = null;
  return { original, sidecar, index };
}

export async function uploadKnowledgeEntryToDrive(entry: DriveKnowledgeEntry) {
  const file = await resumableUpload({
    name: `.ketiengong-entry-${entry.id}.json`,
    mimeType: "application/json",
    data: new Blob([JSON.stringify(entry)], { type: "application/json" }),
    knowledgeId: entry.id,
    kind: "entry",
  });
  entryCache = null;
  return { ...entry, driveFileId: file.id } satisfies DriveKnowledgeEntryRecord;
}

async function listFilesByKind(kind: string) {
  const { folderId } = driveEnv();
  const query = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and appProperties has { key='ketiengongType' and value='${kind}' }`;
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const search = new URL(`${DRIVE_API}/files`);
    search.searchParams.set("q", query);
    search.searchParams.set("spaces", "drive");
    search.searchParams.set("pageSize", "1000");
    search.searchParams.set("orderBy", "createdTime desc");
    search.searchParams.set("includeItemsFromAllDrives", "true");
    search.searchParams.set("supportsAllDrives", "true");
    search.searchParams.set("fields", "nextPageToken,files(id,name,createdTime)");
    if (pageToken) search.searchParams.set("pageToken", pageToken);
    const response = await authorizedFetch(search.toString());
    if (!response.ok) {
      throw new Error(await responseMessage(response, "無法讀取 Google Drive 知識索引"));
    }
    const data = (await response.json()) as DriveFileList;
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken && files.length < 5000);
  return files;
}

async function downloadIndex(file: DriveFile) {
  const response = await authorizedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
  );
  if (!response.ok) return null;
  try {
    const index = (await response.json()) as DriveKnowledgeIndex;
    if (
      index.version !== 1 ||
      !index.knowledgeId ||
      !index.fileName ||
      !Array.isArray(index.chunks)
    ) return null;
    return index;
  } catch {
    return null;
  }
}

export async function loadDriveKnowledgeIndexes() {
  if (!googleDriveStatus().configured) return [];
  if (indexCache && indexCache.expiresAt > Date.now()) return indexCache.indexes;
  const files = await listFilesByKind(INDEX_KIND);
  const indexes: DriveKnowledgeIndex[] = [];
  for (let start = 0; start < files.length; start += 12) {
    const batch = await Promise.all(files.slice(start, start + 12).map(downloadIndex));
    for (const index of batch) if (index) indexes.push(index);
  }
  indexCache = { indexes, expiresAt: Date.now() + 5 * 60_000 };
  return indexes;
}

export async function countDriveKnowledgeDocuments() {
  if (!googleDriveStatus().configured) return 0;
  return (await listFilesByKind(INDEX_KIND)).length;
}

async function downloadEntry(file: DriveFile) {
  const response = await authorizedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
  );
  if (!response.ok) return null;
  try {
    const entry = (await response.json()) as DriveKnowledgeEntry;
    if (
      entry.version !== 1 ||
      !entry.id ||
      !entry.term ||
      !entry.slug ||
      !["pending", "approved", "rejected"].includes(entry.status)
    ) return null;
    return { ...entry, driveFileId: file.id } satisfies DriveKnowledgeEntryRecord;
  } catch {
    return null;
  }
}

export async function loadDriveKnowledgeEntries() {
  if (!googleDriveStatus().configured) return [];
  if (entryCache && entryCache.expiresAt > Date.now()) return entryCache.entries;
  const files = await listFilesByKind(ENTRY_KIND);
  const entries: DriveKnowledgeEntryRecord[] = [];
  for (let start = 0; start < files.length; start += 12) {
    const batch = await Promise.all(files.slice(start, start + 12).map(downloadEntry));
    for (const entry of batch) if (entry) entries.push(entry);
  }
  entries.sort((a, b) => b.createdAt - a.createdAt);
  entryCache = { entries, expiresAt: Date.now() + 60_000 };
  return entries;
}

export async function updateDriveKnowledgeEntry(entry: DriveKnowledgeEntryRecord) {
  const { driveFileId, ...storedEntry } = entry;
  const response = await authorizedFetch(
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(driveFileId)}?uploadType=media&supportsAllDrives=true&fields=id`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(storedEntry),
    },
  );
  if (!response.ok) {
    throw new Error(await responseMessage(response, "Google Drive 詞條更新失敗"));
  }
  entryCache = null;
}

export async function deleteDriveKnowledgeEntries(ids: string[]) {
  const wanted = new Set(ids);
  const entries = await loadDriveKnowledgeEntries();
  const targets = entries.filter((entry) => wanted.has(entry.id));
  let deleted = 0;
  for (let start = 0; start < targets.length; start += 8) {
    const results = await Promise.all(targets.slice(start, start + 8).map(async (entry) => {
      const response = await authorizedFetch(
        `${DRIVE_API}/files/${encodeURIComponent(entry.driveFileId)}?supportsAllDrives=true`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(await responseMessage(response, "Google Drive 詞條刪除失敗"));
      }
      return 1;
    }));
    deleted += results.reduce((sum, value) => sum + value, 0);
  }
  entryCache = null;
  return deleted;
}
