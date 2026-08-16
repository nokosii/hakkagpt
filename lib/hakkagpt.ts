import { getPlatformEnv } from "@/db/runtime";

function extractKnownText(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(extractKnownText);
  if (typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct: string[] = [];
  for (const key of ["output_text", "answer", "text"]) {
    if (typeof record[key] === "string") direct.push(record[key]);
  }
  if (typeof record.content === "string") direct.push(record.content);
  if (Array.isArray(record.content)) direct.push(...record.content.flatMap(extractKnownText));
  for (const key of ["delta", "message", "output", "result", "data", "choices"]) {
    if (record[key]) direct.push(...extractKnownText(record[key]));
  }
  return direct;
}

function extractHakkaGptText(responseText: string): string {
  const raw = responseText.trim();
  if (!raw) return "";
  if (!raw.includes("\ndata:") && !raw.startsWith("data:")) {
    try {
      const candidates = extractKnownText(JSON.parse(raw)).map((value) => value.trim()).filter(Boolean);
      return candidates.at(-1) || raw;
    } catch {
      return raw;
    }
  }

  const completedMessages: string[] = [];
  const completed: string[] = [];
  const deltas: string[] = [];
  const candidates: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as Record<string, unknown>;
      const texts = extractKnownText(json).map((value) => value.trim()).filter(Boolean);
      candidates.push(...texts);
      if (json.status === "completed") completed.push(...texts);
      if (json.type === "message" && json.status === "completed") completedMessages.push(...texts);
      const choices = json.choices as Array<{ delta?: { content?: string } }> | undefined;
      const delta = choices?.[0]?.delta?.content ||
        ((json.delta as { content?: string } | undefined)?.content);
      if (typeof delta === "string") deltas.push(delta);
    } catch {
      candidates.push(data);
    }
  }
  return completedMessages.sort((a, b) => b.length - a.length)[0] ||
    completed.sort((a, b) => b.length - a.length)[0] ||
    deltas.join("").trim() ||
    candidates.sort((a, b) => b.length - a.length)[0] || "";
}

export async function askHakkaGpt(prompt: string): Promise<string> {
  const platformEnv = getPlatformEnv();
  if (!platformEnv.HAKKAGPT_API_TOKEN) {
    throw new Error("HakkaGPT API 尚未設定連線權杖");
  }
  const endpoint = platformEnv.HAKKAGPT_ENDPOINT || "https://hk-gpt.ouob.net/process";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      Authorization: `Bearer ${platformEnv.HAKKAGPT_API_TOKEN}`,
    },
    body: JSON.stringify({
      user_id: platformEnv.HAKKAGPT_USER_ID || "ketiengong-platform",
      session_id: `${Date.now()}-${crypto.randomUUID()}`,
      agent_id: platformEnv.HAKKAGPT_AGENT_ID || "hakka-gpt",
      stream: true,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HakkaGPT 暫時無法回應（${response.status}）`);
  const answer = extractHakkaGptText(text).trim();
  if (!answer) throw new Error("HakkaGPT 未傳回可顯示內容");
  return answer;
}
