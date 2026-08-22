import { DIALECTS, type DialectTag } from "@/lib/governance";
import {
  expandKnowledgeGraph,
  type KnowledgeGraphNode,
  type KnowledgeGraphNodeKind,
} from "@/lib/knowledge-graph";

export const runtime = "edge";

const nodeKinds = new Set<KnowledgeGraphNodeKind>([
  "root",
  "concept",
  "evidence",
  "culture",
  "dialect",
  "person",
  "place",
  "event",
]);

function readFocus(value: unknown): KnowledgeGraphNode | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id || "").trim().slice(0, 160);
  const label = String(raw.label || "").replace(/\*/g, "").trim().slice(0, 80);
  const summary = String(raw.summary || "").replace(/\*/g, "").trim().slice(0, 600);
  const kind = String(raw.kind || "concept") as KnowledgeGraphNodeKind;
  if (!id || label.length < 2 || !nodeKinds.has(kind)) return null;
  return {
    id,
    label,
    summary,
    kind,
    depth: Math.max(0, Math.min(12, Number(raw.depth) || 0)),
    impact: Math.max(0, Math.min(100, Number(raw.impact) || 60)),
    dialect: String(raw.dialect || "未指定").slice(0, 20),
    sourceIds: Array.isArray(raw.sourceIds)
      ? raw.sourceIds.slice(0, 12).map((item) => String(item).slice(0, 160))
      : [],
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const focus = readFocus(body.focus);
    const rootQuestion = String(body.rootQuestion || "").trim();
    if (!focus || rootQuestion.length < 2 || rootQuestion.length > 1200) {
      return Response.json({ error: "圖譜節點或原始問題格式不正確" }, { status: 400 });
    }
    const existingLabels = Array.isArray(body.existingLabels)
      ? body.existingLabels.slice(0, 200).map((label) => String(label).replace(/\*/g, "").trim().slice(0, 80)).filter(Boolean)
      : [];
    const dialect = DIALECTS.includes(body.dialect as DialectTag)
      ? body.dialect as DialectTag
      : "未標示";
    const iteration = Math.max(1, Math.min(30, Number(body.iteration) || 1));
    const branch = await expandKnowledgeGraph({ focus, rootQuestion, existingLabels, dialect, iteration });
    return Response.json(branch);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "節點延伸失敗，請稍後再試" },
      { status: 500 },
    );
  }
}
