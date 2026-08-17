import { requireAdmin } from "@/lib/admin-auth";
import { listKnowledgeEntries } from "@/lib/knowledge-entries";

export const runtime = "edge";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? new Set(body.ids.map((id) => String(id).trim()).filter(Boolean))
      : null;
    const entries = (await listKnowledgeEntries(5000)).filter((entry) =>
      entry.author_id !== "system" && (!ids?.size || ids.has(entry.id)),
    );
    const rows = [
      ["詞條名稱", "摘要", "完整內容", "參考來源", "狀態", "提交者", "審查備註", "建立時間", "審查時間"],
      ...entries.map((entry) => [
        entry.term,
        entry.summary,
        entry.content,
        entry.source_url,
        entry.status,
        entry.author_email,
        entry.review_note,
        new Date(entry.created_at).toISOString(),
        entry.reviewed_at ? new Date(entry.reviewed_at).toISOString() : "",
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ketiengong-entries-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "資料匯出失敗" }, { status: 500 });
  }
}
