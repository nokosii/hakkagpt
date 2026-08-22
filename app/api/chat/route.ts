import { askHakkaGpt } from "@/lib/hakkagpt";
import { retrieveKnowledge } from "@/lib/knowledge";
import {
  buildBlockedKnowledgeGraph,
  generateInitialKnowledgeGraph,
} from "@/lib/knowledge-graph";

export const runtime = "edge";

function explicitlyRequestsHakkaRomanization(question: string) {
  return /客語拼音|拼音|羅馬字|標音|讀音|發音|怎麼唸|怎麼讀|仰般讀|聲調|腔調拼音/i.test(question);
}

function asksForIdentifiableStyleImitation(question: string) {
  const creationIntent = /(模仿|仿作|仿寫|照(?:著|着)?|沿用|複製).{0,28}(風格|口吻|筆法|文風)|(用|以).{1,20}(風格|口吻|筆法|文風).{0,20}(寫|創作|生成)/;
  const identifiableTarget = /(作家|詩人|作者|老師|先生|女士|[\p{Script=Han}]{2,5}(?:的|之)?(?:風格|口吻|筆法|文風))/u;
  return creationIntent.test(question) && identifiableTarget.test(question);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string };
    const question = String(body.question || "").trim();
    if (question.length < 2 || question.length > 1200) {
      return Response.json({ error: "請輸入 2 至 1200 字的問題" }, { status: 400 });
    }

    if (asksForIdentifiableStyleImitation(question)) {
      return Response.json({
        answer: "為維護文學誠信與作者權益，我不能依可辨識作家或詩人的風格仿作新作品。我可以改為分析其作品特徵、比較修辭與敘事方法，或依你指定的題材、節奏、視角等非特定元素創作原創文本。",
        sources: [],
        evidenceState: "blocked",
        safetyReason: "可辨識作者風格仿作防護",
        graph: buildBlockedKnowledgeGraph(question, "未標示"),
      });
    }

    const { sources, context, evidenceState } = await retrieveKnowledge(question);
    const romanizationRequested = explicitlyRequestsHakkaRomanization(question);
    const prompt = [
      "你是『客天光・客家GPT』的客家知識專家。HakkaGPT API 是主要回答與檢索引擎，請直接回答使用者問題。",
      "回答格式規則：全文不得出現星號字元，不使用 Markdown 粗體或斜體語法。預設只使用繁體中文與必要的客語漢字，不主動附上客語拼音、羅馬字或聲調標記。",
      romanizationRequested
        ? "使用者已明確要求客語拼音或發音，本題可以清楚分列客語拼音。"
        : "使用者未要求客語拼音，本題禁止列出客語拼音、羅馬字或聲調標記。",
      "使用者不指定回答腔別。不得自行統一或指定腔別；只有引用資料本身明確標示腔別時，才在相應內容中說明該資料的腔別。資料未標示腔別時不要自行補上。",
      "只可把下列 RAG 資料稱為本平台證據。每個由平台資料支持的重點，請在句末標示相應的〔資料 1〕格式。不得改寫來源作者、權利與腔別資訊。HakkaGPT 自身知識或檢索結果不可標成平台資料。",
      "回答文學問題時可分析特徵與教學方法，但不得抄襲，也不得模仿可辨識作者的風格產生新作品。",
      context
        ? "以下資料是本平台 RAG 提供的輔助資料；只在確實相關時引用。暫行內容可先供查詢，但回答時須明確標示尚未通過技術適切性與文化安全雙閘門。"
        : "本題沒有命中本平台 RAG 輔助資料。請直接使用 HakkaGPT API 自身可用的知識與檢索能力回答，不要提及平台資料是否命中，也不要加入平台資料不足的提示。",
      context || "",
      `使用者問題：${question}`,
    ].filter(Boolean).join("\n\n");
    const [answer, graph] = await Promise.all([
      askHakkaGpt(prompt),
      generateInitialKnowledgeGraph({
        question,
        sources,
        dialect: "未標示",
      }),
    ]);
    const cleanedAnswer = answer.replace(/\*/g, "").trim();
    const finalAnswer = cleanedAnswer
      .replace(/^平台證據不足[。！!：:\s]*/u, "")
      .trim() || "HakkaGPT 暫時沒有提供回答。";
    return Response.json({
      answer: finalAnswer,
      sources,
      evidenceState: sources.length ? evidenceState : "hakkagpt",
      graph,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "查詢失敗，請稍後再試" },
      { status: 500 },
    );
  }
}
