import { ensureSchema, getPlatformEnv, requestIdentity } from "@/db/runtime";
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
  const text = value.replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
  const chunks: string[] = [];
  const size = 1400;
  const overlap = 180;
  for (let start = 0; start < text.length && chunks.length < 140; start += size - overlap) {
    const chunk = text.slice(start, start + size).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
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
    const DB = await ensureSchema();
    if (!platformEnv.KNOWLEDGE_FILES) throw new Error("檔案儲存空間尚未連線");
    const id = crypto.randomUUID();
    const objectKey = `knowledge/${id}/${file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-")}`;
    await platformEnv.KNOWLEDGE_FILES.put(objectKey, buffer, {
      httpMetadata: { contentType: file.type || (fileType === "pdf" ? "application/pdf" : "text/csv") },
      customMetadata: { ownerId: identity.id, originalName: file.name },
    });

    const now = Date.now();
    await DB.prepare(`INSERT INTO knowledge_documents (
      id, file_name, file_type, object_key, byte_size, page_count, row_count,
      chunk_count, status, owner_id, owner_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`)
      .bind(id, file.name, fileType, objectKey, file.size, pageCount, rowCount, chunks.length, identity.id, identity.email, now)
      .run();
    for (let start = 0; start < chunks.length; start += 80) {
      await DB.batch(
        chunks.slice(start, start + 80).map((content, offset) =>
          DB.prepare(`INSERT INTO knowledge_chunks (id, document_id, chunk_index, content, created_at)
            VALUES (?, ?, ?, ?, ?)`)
            .bind(crypto.randomUUID(), id, start + offset, content, now),
        ),
      );
    }
    return Response.json({
      id,
      fileName: file.name,
      fileType,
      rowCount,
      pageCount,
      chunkCount: chunks.length,
      status: "ready",
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "檔案匯入失敗" }, { status: 500 });
  }
}
