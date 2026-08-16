import { askHakkaGpt } from "@/lib/hakkagpt";
import { retrieveKnowledge } from "@/lib/knowledge";

export const runtime = "edge";

function explicitlyRequestsHakkaRomanization(question: string) {
  return /客語拼音|拼音|羅馬字|標音|讀音|發音|怎麼唸|怎麼讀|仰般讀|聲調|腔調拼音/i.test(question);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string };
    const question = String(body.question || "").trim();
    if (question.length < 2 || question.length > 1200) {
      return Response.json({ error: "請輸入 2 至 1200 字的問題" }, { status: 400 });
    }

    const { sources, context } = await retrieveKnowledge(question);
    const romanizationRequested = explicitlyRequestsHakkaRomanization(question);
    const prompt = [
      "你是『客天光・客家GPT』的客家知識專家。請直接回答使用者問題。",
      "回答格式規則：全文不得出現星號字元，不使用 Markdown 粗體或斜體語法。預設只使用繁體中文與必要的客語漢字，不主動附上客語拼音、羅馬字或聲調標記。",
      romanizationRequested
        ? "使用者已明確要求客語拼音或發音，本題可以清楚分列客語拼音。"
        : "使用者未要求客語拼音，本題禁止列出客語拼音、羅馬字或聲調標記。",
      "若資料不足，請清楚說明不確定之處，不要捏造。",
      context
        ? "以下資料由本平台的 RAG 檢索提供；『共編待審』內容依平台規則暫時優先，但回答時須明確標示仍待審查。"
        : "本題沒有命中平台補充資料，請依 HakkaGPT 既有知識審慎回答。",
      context || "",
      `使用者問題：${question}`,
    ].filter(Boolean).join("\n\n");
    const answer = await askHakkaGpt(prompt);
    return Response.json({ answer: answer.replace(/\*/g, "").trim(), sources });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "查詢失敗，請稍後再試" },
      { status: 500 },
    );
  }
}
