import { askHakkaGpt } from "@/lib/hakkagpt";
import { retrieveKnowledge } from "@/lib/knowledge";
import { DIALECTS, type DialectTag } from "@/lib/governance";
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
    const body = (await request.json()) as { question?: string; dialect?: string };
    const question = String(body.question || "").trim();
    if (question.length < 2 || question.length > 1200) {
      return Response.json({ error: "請輸入 2 至 1200 字的問題" }, { status: 400 });
    }

    const dialect = DIALECTS.includes(body.dialect as DialectTag)
      ? body.dialect as DialectTag
      : undefined;
    if (asksForIdentifiableStyleImitation(question)) {
      return Response.json({
        answer: "為維護文學誠信與作者權益，我不能依可辨識作家或詩人的風格仿作新作品。我可以改為分析其作品特徵、比較修辭與敘事方法，或依你指定的題材、節奏、視角等非特定元素創作原創文本。",
        sources: [],
        evidenceState: "blocked",
        safetyReason: "可辨識作者風格仿作防護",
        graph: buildBlockedKnowledgeGraph(question, dialect || "未指定"),
      });
    }

    const { sources, context, evidenceState } = await retrieveKnowledge(question, dialect);
    const romanizationRequested = explicitlyRequestsHakkaRomanization(question);
    const prompt = [
      "你是『客天光・客家GPT』的客家知識專家。請直接回答使用者問題。",
      "回答格式規則：全文不得出現星號字元，不使用 Markdown 粗體或斜體語法。預設只使用繁體中文與必要的客語漢字，不主動附上客語拼音、羅馬字或聲調標記。",
      romanizationRequested
        ? "使用者已明確要求客語拼音或發音，本題可以清楚分列客語拼音。"
        : "使用者未要求客語拼音，本題禁止列出客語拼音、羅馬字或聲調標記。",
      dialect && dialect !== "未標示"
        ? `本題指定 ${dialect} 腔。優先使用相同腔別證據；引用其他腔別時必須明確標示跨腔，不可把不同腔別默默同質化。`
        : "本題未指定腔別。回答涉及客語差異時，須保留來源的腔別標示，不可把各腔平均化或視為完全相同。",
      "只可把下列 RAG 資料稱為平台證據。每個由資料支持的重點，請在句末標示相應的〔資料 1〕格式。不得改寫來源作者、權利與腔別資訊。",
      "若資料不足，先明確說明平台證據不足；不得捏造引文、出處、作者、腔別或文化細節，也不得把模型記憶假稱為檢索結果。",
      "回答文學問題時可分析特徵與教學方法，但不得抄襲，也不得模仿可辨識作者的風格產生新作品。",
      context
        ? "以下資料由本平台的社群治理型 RAG 檢索提供；暫行內容可先供查詢，但回答時須明確標示尚未通過技術適切性與文化安全雙閘門。"
        : "本題沒有命中公開層平台資料。可提供審慎的一般說明，但開頭必須明示『平台證據不足』，且不可製造引用標記。",
      context || "",
      `使用者問題：${question}`,
    ].filter(Boolean).join("\n\n");
    const [answer, graph] = await Promise.all([
      askHakkaGpt(prompt),
      generateInitialKnowledgeGraph({
        question,
        sources,
        dialect: dialect || "未指定",
      }),
    ]);
    return Response.json({
      answer: answer.replace(/\*/g, "").trim(),
      sources,
      evidenceState,
      dialect: dialect || "未指定",
      graph,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "查詢失敗，請稍後再試" },
      { status: 500 },
    );
  }
}
