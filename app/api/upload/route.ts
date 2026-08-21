import { ensureSchema, getPlatformEnv, requestIdentity } from "@/db/runtime";
import { googleDriveStatus, uploadKnowledgeToDrive } from "@/lib/google-drive";
import { EMPTY_REVIEW_GATES, normalizeGovernance, type GovernanceMetadata } from "@/lib/governance";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "edge";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 180_000;

function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows[0] || [];
  const lines = rows.slice(1, 5001).map((values, rowIndex) => {
    const fields = headers.map((header, column) => `${header || `欄位${column + 1}`}：${values[column] || ""}`);
    return `第 ${rowIndex + 1} 筆｜${fields.join("｜")}`;
  });
  return { text: lines.join("\n"), rowCount: Math.max(0, rows.length - 1) };
}

function makeChunks(value: string) {
  const text = value.split("\u0000").join("").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
  const chunks: string[] = [];
  const size = 1400;
  const overlap = 180;
  for (let start = 0; start < text.length && chunks.length < 140; start += size - overlap) {
    const chunk = text.slice(start, start + size).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

async function saveSearchIndex(args: {
  id: string;
  fileName: string;
  fileType: "csv" | "pdf";
  objectKey: string;
  byteSize: number;
  pageCount: number | null;
  rowCount: number | null;
  chunks: string[];
  ownerId: string;
  ownerEmail: string;
  createdAt: number;
  governance: GovernanceMetadata;
}) {
  const DB = await ensureSchema();
  await DB.batch([DB.prepare(`INSERT INTO knowledge_documents (
    id, file_name, file_type, object_key, byte_size, page_count, row_count,
    chunk_count, status, owner_id, owner_email, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .bind(
      args.id,
      args.fileName,
      args.fileType,
      args.objectKey,
      args.byteSize,
      args.pageCount,
      args.rowCount,
      args.chunks.length,
      args.ownerId,
      args.ownerEmail,
      args.createdAt,
    )
  , DB.prepare(`INSERT OR REPLACE INTO knowledge_governance (
      record_id, record_kind, dialect, rights_holder, rights_basis, license,
      access_level, community_benefit, consent_confirmed, review_gates, withdrawn_at, updated_at
    ) VALUES (?, 'document', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).bind(
      args.id,
      args.governance.dialect,
      args.governance.rightsHolder,
      args.governance.rightsBasis,
      args.governance.license,
      args.governance.accessLevel,
      args.governance.communityBenefit,
      args.governance.consentConfirmed ? 1 : 0,
      JSON.stringify(EMPTY_REVIEW_GATES),
      args.createdAt,
    )]);
  for (let start = 0; start < args.chunks.length; start += 80) {
    await DB.batch(
      args.chunks.slice(start, start + 80).map((content, offset) =>
        DB.prepare(`INSERT INTO knowledge_chunks (id, document_id, chunk_index, content, created_at)
          VALUES (?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), args.id, start + offset, content, args.createdAt),
      ),
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "請選擇 CSV 或 PDF 檔案" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "檔案上限為 10 MB" }, { status: 413 });

    const lowerName = file.name.toLowerCase();
    const fileType = lowerName.endsWith(".csv") ? "csv" : lowerName.endsWith(".pdf") ? "pdf" : null;
    if (!fileType) return Response.json({ error: "目前只接受 .csv 與 .pdf" }, { status: 415 });
    const governance = normalizeGovernance({
      dialect: form.get("dialect"),
      rightsHolder: form.get("rightsHolder"),
      rightsBasis: form.get("rightsBasis"),
      license: form.get("license"),
      accessLevel: form.get("accessLevel"),
      communityBenefit: form.get("communityBenefit"),
      consentConfirmed: form.get("consentConfirmed") === "true",
    });
    if (governance.rightsHolder === "未標示") {
      return Response.json({ error: "請填寫作者或權利持有人" }, { status: 400 });
    }
    if (!governance.consentConfirmed) {
      return Response.json({ error: "請確認具備提交與社群使用這份資料的權利" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    let extracted = "";
    let pageCount: number | null = null;
    let rowCount: number | null = null;
    if (fileType === "csv") {
      const parsed = parseCsv(new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, ""));
      extracted = parsed.text;
      rowCount = parsed.rowCount;
    } else {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const parsed = await extractText(pdf, { mergePages: true });
      extracted = parsed.text;
      pageCount = parsed.totalPages;
    }
    const chunks = makeChunks(extracted);
    if (!chunks.length) {
      return Response.json({ error: fileType === "pdf" ? "PDF 沒有可抽取的文字層" : "CSV 沒有可匯入的資料列" }, { status: 422 });
    }

    const identity = requestIdentity(request);
    const platformEnv = getPlatformEnv();
    const id = crypto.randomUUID();
    const mimeType = file.type || (fileType === "pdf" ? "application/pdf" : "text/csv");
    const now = Date.now();
    let storage: "google-drive" | "r2";
    let objectKey: string;
    let driveFileId: string | null = null;
    let databaseIndexed = false;

    if (googleDriveStatus(platformEnv).configured) {
      const driveUpload = await uploadKnowledgeToDrive({
        id,
        fileName: file.name,
        fileType,
        mimeType,
        buffer,
        pageCount,
        rowCount,
        chunks,
        governance,
        ownerId: identity.id,
        ownerEmail: identity.email,
      });
      storage = "google-drive";
      driveFileId = driveUpload.original.id;
      objectKey = `gdrive:${driveFileId}`;
      try {
        await saveSearchIndex({
          id,
          fileName: file.name,
          fileType,
          objectKey,
          byteSize: file.size,
          pageCount,
          rowCount,
          chunks,
          ownerId: identity.id,
          ownerEmail: identity.email,
          createdAt: now,
          governance,
        });
        databaseIndexed = true;
      } catch {
        // Google Drive 的索引檔本身可供 Render 查詢，D1 僅作 Sites 的加速副本。
      }
    } else {
      if (!platformEnv.KNOWLEDGE_FILES) {
        const state = googleDriveStatus(platformEnv);
        throw new Error(`檔案儲存空間尚未連線；Google Drive 尚缺：${state.missing.join("、")}`);
      }
      storage = "r2";
      objectKey = `knowledge/${id}/${file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-")}`;
      await platformEnv.KNOWLEDGE_FILES.put(objectKey, buffer, {
        httpMetadata: { contentType: mimeType },
        customMetadata: {
          ownerId: identity.id,
          originalName: file.name,
          dialect: governance.dialect,
          accessLevel: governance.accessLevel,
        },
      });
      await saveSearchIndex({
        id,
        fileName: file.name,
        fileType,
        objectKey,
        byteSize: file.size,
        pageCount,
        rowCount,
        chunks,
        ownerId: identity.id,
        ownerEmail: identity.email,
        createdAt: now,
        governance,
      });
      databaseIndexed = true;
    }
    return Response.json({
      id,
      fileName: file.name,
      fileType,
      rowCount,
      pageCount,
      chunkCount: chunks.length,
      status: "pending",
      storage,
      driveFileId,
      databaseIndexed,
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "檔案匯入失敗" }, { status: 500 });
  }
}
