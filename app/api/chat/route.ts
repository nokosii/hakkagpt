import { askHakkaGpt } from "@/lib/hakkagpt";
import { retrieveKnowledge } from "@/lib/knowledge";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string };
    const question = String(body.question || "").trim();
    if (question.length < 2 || question.length > 1200) {
      return Response.json({ error: "請輸入 2 至 1200 字的問題" }, { status: 400 });
    }

    const { sources, context } = await retrieveKnowledge(question);
    const prompt = context
      ? [
          "你是『客天光・客家GPT』的客家知識專家。請直接回答使用者問題。",
          "以下資料由本平台的 RAG 檢索提供；『共編待審』內容依平台規則暫時優先，但回答時須明確標示仍待審查。若資料不足，請清楚說明不確定之處，不要捏造。",
          context,
          `使用者問題：${question}`,
        ].join("\n\n")
      : question;
    const answer = await askHakkaGpt(prompt);
    return Response.json({ answer, sources });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "查詢失敗，請稍後再試" },
      { status: 500 },
    );
  }
}
