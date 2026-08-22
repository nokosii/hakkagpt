import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the 客天光 platform", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /客天光/);
  assert.match(html, /客家GPT/);
  assert.match(html, /HakkaGPT：結合RAG與大型語言模型之客家知識AI專家對話系統/);
  assert.match(html, /知識治理/);
  assert.match(html, /客家圖講/);
  assert.match(html, /依提問相關度生成/);
  assert.match(html, /全螢幕/);
  assert.match(html, /點選節點可產生下一層關聯/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("blocks identifiable-author style imitation before calling the model", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("guard-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "請模仿某位作家的文風寫一篇新小說", dialect: "四縣" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.evidenceState, "blocked");
  assert.match(data.safetyReason, /作者風格仿作防護/);
  assert.doesNotMatch(data.answer, /\*/);
  assert.equal(data.graph.nodes.length, 4);
  assert.equal(data.graph.edges.length, 3);
  assert.equal(data.graph.rootId, data.graph.nodes[0].id);
});

test("validates graph expansion before calling the model", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("graph-validation", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/graph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ focus: { label: "缺少識別碼" }, rootQuestion: "測試問題" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.match(data.error, /格式不正確/);
});

test("declares durable knowledge storage and product metadata", async () => {
  const [hosting, layout, page, platform, graphComponent, knowledge, graph, packageJson] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HakkaPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/KnowledgeGraph.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/knowledge.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/knowledge-graph.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "KNOWLEDGE_FILES"/);
  assert.match(layout, /客天光｜客家GPT/);
  assert.match(layout, /og\.png/);
  assert.match(page, /HakkaPlatform/);
  assert.match(platform, /CARE \+ OCAP KNOWLEDGE GOVERNANCE/);
  assert.match(platform, /六腔不平均/);
  assert.match(platform, /graphExpansionLocksRef/);
  assert.match(graphComponent, /requestFullscreen/);
  assert.match(graphComponent, /expandedNodeIds\.includes/);
  assert.match(graphComponent, /已展開/);
  assert.match(knowledge, /source\.relevance >= minimumRelevance\(question\)/);
  assert.match(knowledge, /b\.relevance - a\.relevance/);
  assert.match(graph, /selectGraphEvidenceSources/);
  assert.match(graph, /source\.kind !== "document" \|\| source\.relevance >= documentThreshold/);
  assert.match(graph, /BLOCKED_GRAPH_LABELS/);
  assert.match(graph, /replace\(\/待探索\/g/);
  assert.doesNotMatch(graph, /label: "平台證據不足"/);
  assert.doesNotMatch(graph, /label: "待探索"/);
  assert.doesNotMatch(graph, /kind: "evidence",/);
  assert.doesNotMatch(graph, /const evidenceNodes/);
  assert.doesNotMatch(graph, /label: "支持"/);
  assert.match(graph, /不得建立資料來源、文件、RAG 證據或引用節點/);
  assert.match(packageJson, /"name": "ketiengong-hakka-gpt"/);
});
