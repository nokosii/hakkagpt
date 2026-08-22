import { requestIdentity } from "@/db/runtime";
import { createKnowledgeEntry } from "@/lib/knowledge-entries";
import { EMPTY_REVIEW_GATES } from "@/lib/governance";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string; answerNotFullyCorrect?: boolean };
    const question = String(body.question || "").trim();
    if (!body.answerNotFullyCorrect) {
      return Response.json({ error: "請先確認本題回答並非完全正確" }, { status: 400 });
    }
    if (question.length < 2 || question.length > 1200) {
      return Response.json({ error: "問題需為 2 至 1200 字" }, { status: 400 });
    }

    const identity = requestIdentity(request);
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    await createKnowledgeEntry({
      id,
      term: question.slice(0, 80),
      slug: `待解-${id}`,
      summary: "待解決之客家相關問題",
      content: `問題：${question}\n\n使用者認為本題回答並非完全正確，尚待社群補充或修正解答。`,
      source_url: null,
      status: "pending",
      author_id: identity.id,
      author_email: identity.email,
      reviewer_email: null,
      review_note: "列為待解決之客家相關問題",
      created_at: createdAt,
      reviewed_at: null,
      governance: {
        dialect: "未標示",
        rightsHolder: identity.email === "anonymous@ketiengong.tw" ? "匿名提問者" : identity.email,
        rightsBasis: "本人創作",
        license: "僅供本平台社群共同解答",
        accessLevel: "community",
        communityBenefit: "補足本系統尚未收集的客家知識",
        consentConfirmed: true,
      },
      review_gates: EMPTY_REVIEW_GATES,
    });

    return Response.json({ id, status: "pending" }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "待解問題儲存失敗" }, { status: 500 });
  }
}
