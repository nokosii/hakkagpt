"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type View = "chat" | "contribute" | "upload" | "review";
type Source = {
  id: string;
  title: string;
  kind: "entry" | "document";
  status: "pending" | "approved" | "ready";
  excerpt: string;
  sourceUrl?: string | null;
};
type ChatMessage = { role: "user" | "assistant"; text: string; sources?: Source[] };
type StatusData = {
  apiConnected: boolean;
  entryCount: number;
  documentCount: number;
  pendingCount: number;
  reviewer: boolean;
};
type ReviewEntry = {
  id: string;
  term: string;
  summary: string;
  content: string;
  source_url: string | null;
  author_email: string;
  created_at: number;
};

const navItems: Array<{ id: View; label: string; kicker: string; glyph: string }> = [
  { id: "chat", label: "智識問答", kicker: "ASK", glyph: "光" },
  { id: "contribute", label: "共創詞條", kicker: "EDIT", glyph: "編" },
  { id: "upload", label: "知識匯入", kicker: "RAG", glyph: "入" },
  { id: "review", label: "審查中心", kicker: "REVIEW", glyph: "審" },
];

const suggestions = [
  "天穿日為什麼對客庄重要？",
  "客家義民信仰如何形成？",
  "四縣腔和海陸腔有什麼差異？",
];

function statusLabel(status: Source["status"]) {
  if (status === "pending") return "共編待審";
  if (status === "approved") return "審查通過";
  return "文件匯入";
}

export function HakkaPlatform() {
  const [activeView, setActiveView] = useState<View>("chat");
  const [status, setStatus] = useState<StatusData>({
    apiConnected: false,
    entryCount: 0,
    documentCount: 0,
    pendingCount: 0,
    reviewer: false,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "日安，我係客天光。您可以問客語、客庄歷史、信仰、文學或生活文化；回答會優先參考平台共編與匯入的知識，再由 HakkaGPT 統整。",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [latestSources, setLatestSources] = useState<Source[]>([]);
  const [notice, setNotice] = useState("");
  const [reviewEntries, setReviewEntries] = useState<ReviewEntry[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [statusResponse, reviewResponse] = await Promise.all([
      fetch("/api/status", { cache: "no-store" }),
      fetch("/api/review", { cache: "no-store" }),
    ]);
    if (statusResponse.ok) setStatus(await statusResponse.json());
    if (reviewResponse.ok) {
      const data = (await reviewResponse.json()) as { entries: ReviewEntry[]; reviewer: boolean };
      setReviewEntries(data.entries);
      setStatus((current) => ({ ...current, reviewer: data.reviewer }));
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setNotice("平台狀態暫時無法更新"));
  }, [refresh]);

  async function ask(event?: FormEvent, suggested?: string) {
    event?.preventDefault();
    const nextQuestion = (suggested ?? question).trim();
    if (!nextQuestion || asking) return;
    setQuestion("");
    setAsking(true);
    setMessages((current) => [...current, { role: "user", text: nextQuestion }]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion }),
      });
      const data = (await response.json()) as { answer?: string; sources?: Source[]; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || "查詢失敗");
      const sources = data.sources || [];
      setLatestSources(sources);
      setMessages((current) => [...current, { role: "assistant", text: data.answer!, sources }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: error instanceof Error ? error.message : "查詢失敗，請稍後再試。" },
      ]);
    } finally {
      setAsking(false);
    }
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term: form.get("term"),
        summary: form.get("summary"),
        content: form.get("content"),
        sourceUrl: form.get("sourceUrl"),
      }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setNotice(data.error || "詞條送出失敗");
      return;
    }
    event.currentTarget.reset();
    setNotice("詞條已送出並立即納入查詢；審查未通過時會自動退回上一個正式版本。");
    await refresh();
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await response.json()) as {
        error?: string;
        chunkCount?: number;
        pageCount?: number | null;
        rowCount?: number | null;
      };
      if (!response.ok) throw new Error(data.error || "檔案匯入失敗");
      const detail = data.pageCount
        ? `${data.pageCount} 頁`
        : `${data.rowCount || 0} 筆資料列`;
      setNotice(`知識匯入完成：${detail}，建立 ${data.chunkCount} 個可檢索片段。`);
      event.currentTarget.reset();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "檔案匯入失敗");
    } finally {
      setUploading(false);
    }
  }

  async function review(id: string, action: "approve" | "reject") {
    setReviewLoading(id);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, note: reviewNotes[id] || "" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "審查更新失敗");
      setNotice(action === "approve" ? "詞條已通過，正式納入知識庫。" : "詞條未通過，查詢已退回最近的正式版本。");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "審查更新失敗");
    } finally {
      setReviewLoading(null);
    }
  }

  return (
    <div className="platform-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => setActiveView("chat")} aria-label="回到智識問答">
          <span className="brand-sun" aria-hidden="true">日</span>
          <span>
            <strong>客天光</strong>
            <small>客家GPT</small>
          </span>
        </button>

        <nav className="main-nav" aria-label="主要功能">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeView === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setActiveView(item.id)}
            >
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
              <span><strong>{item.label}</strong><small>{item.kicker}</small></span>
              {item.id === "review" && status.pendingCount > 0 ? (
                <b className="nav-count">{status.pendingCount}</b>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="eyebrow">KNOWLEDGE FLOW</span>
          <p>公眾共編先行，專家審查校準。每一筆修訂都留下版本軌跡。</p>
        </div>

        <div className="api-state">
          <span className={status.apiConnected ? "state-dot online" : "state-dot"} />
          <span>{status.apiConnected ? "HakkaGPT RAG 已連線" : "等待 API 連線"}</span>
        </div>
      </aside>

      <div className="content-column">
        <header className="topbar">
          <div>
            <span className="section-index">KTG / {navItems.findIndex((item) => item.id === activeView) + 1}</span>
            <span className="topbar-title">{navItems.find((item) => item.id === activeView)?.label}</span>
          </div>
          <div className="topbar-stats" aria-label="知識庫統計">
            <span><b>{status.entryCount}</b> 詞條</span>
            <span><b>{status.documentCount}</b> 文件</span>
            <span><b>{status.pendingCount}</b> 待審</span>
          </div>
        </header>

        <main>
          {notice ? (
            <div className="notice" role="status">
              <span>✦</span><p>{notice}</p><button type="button" onClick={() => setNotice("")} aria-label="關閉通知">×</button>
            </div>
          ) : null}

          {activeView === "chat" ? (
            <section className="chat-view">
              <div className="chat-main">
                <div className="hero-copy">
                  <span className="eyebrow">HAKKA KNOWLEDGE, FIRST LIGHT</span>
                  <h1>問一件事，<br /><em>看見客庄的天光。</em></h1>
                  <p>把散落在詞條、田野資料與文件裡的客家知識，整理成有來源、可共編、能追溯的回答。</p>
                </div>

                <div className="conversation" aria-live="polite">
                  {messages.map((message, index) => (
                    <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
                      <div className="message-meta">
                        <span>{message.role === "assistant" ? "客天光" : "你"}</span>
                        {message.role === "assistant" ? <small>HakkaGPT + RAG</small> : <small>提問</small>}
                      </div>
                      <div className="message-body">{message.text}</div>
                    </article>
                  ))}
                  {asking ? (
                    <article className="message assistant thinking">
                      <div className="message-meta"><span>客天光</span><small>正在查找知識</small></div>
                      <div className="thinking-line"><i /><i /><i /></div>
                    </article>
                  ) : null}
                </div>

                <form className="ask-box" onSubmit={(event) => ask(event)}>
                  <label htmlFor="question">想了解哪一段客家知識？</label>
                  <div className="ask-row">
                    <textarea
                      id="question"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="例如：天穿日的由來是什麼？"
                      rows={2}
                      maxLength={1200}
                    />
                    <button type="submit" disabled={asking || !question.trim()}>
                      <span>送出提問</span><b aria-hidden="true">↗</b>
                    </button>
                  </div>
                  <div className="suggestions">
                    <span>可先問：</span>
                    {suggestions.map((item) => (
                      <button key={item} type="button" onClick={() => ask(undefined, item)}>{item}</button>
                    ))}
                  </div>
                </form>
              </div>

              <aside className="evidence-rail">
                <div className="rail-heading">
                  <span className="eyebrow">RAG EVIDENCE</span>
                  <h2>這次回答<br />參考了什麼</h2>
                </div>
                {latestSources.length ? latestSources.map((source, index) => (
                  <article className="source-card" key={source.id}>
                    <div className="source-top">
                      <span>0{index + 1}</span>
                      <b className={`source-status ${source.status}`}>{statusLabel(source.status)}</b>
                    </div>
                    <h3>{source.title}</h3>
                    <p>{source.excerpt.slice(0, 118)}{source.excerpt.length > 118 ? "…" : ""}</p>
                    {source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer">查看原始來源 ↗</a> : null}
                  </article>
                )) : (
                  <div className="rail-empty">
                    <span aria-hidden="true">⌁</span>
                    <p>送出問題後，這裡會列出命中的共編詞條與匯入文件。</p>
                  </div>
                )}
                <div className="precedence-note">
                  <b>查詢優先規則</b>
                  <ol>
                    <li><span>1</span>最新共編待審版本</li>
                    <li><span>2</span>最近審查通過版本</li>
                    <li><span>3</span>CSV／PDF 文件片段</li>
                  </ol>
                </div>
              </aside>
            </section>
          ) : null}

          {activeView === "contribute" ? (
            <section className="workspace-view">
              <header className="workspace-hero">
                <span className="eyebrow">WIKIPEDIA-STYLE CO-CREATION</span>
                <h1>一人補一筆，<em>共下寫客庄。</em></h1>
                <p>像 Wikipedia 一樣留下每次修訂。新版本送出後會先服務查詢，專家審查未通過時，系統自動回復最近的正式版本。</p>
              </header>
              <div className="workspace-grid">
                <form className="editor-panel" onSubmit={submitEntry}>
                  <div className="panel-title"><span>01</span><div><h2>新增或修訂詞條</h2><p>所有欄位都會保留在版本紀錄</p></div></div>
                  <label>詞條名稱<input name="term" required minLength={2} maxLength={80} placeholder="例：新丁粄" /></label>
                  <label>一句摘要<input name="summary" required minLength={4} maxLength={240} placeholder="用一句話說明這個詞條" /></label>
                  <label>完整內容<textarea name="content" required minLength={10} maxLength={12000} rows={9} placeholder="說明由來、地區差異、使用情境與相關背景…" /></label>
                  <label>參考來源（選填）<input name="sourceUrl" type="url" placeholder="https://" /></label>
                  <div className="form-footer">
                    <span>送出即建立「待審版本」</span>
                    <button className="primary-action" type="submit">送出共編 <b>↗</b></button>
                  </div>
                </form>
                <div className="workflow-panel">
                  <span className="eyebrow">VERSION GOVERNANCE</span>
                  <h2>不是先等審查，<br />而是讓知識先流動。</h2>
                  <div className="workflow-step active"><b>1</b><div><strong>共編發布</strong><p>新版本立即進入 RAG，回答會註明「共編待審」。</p></div></div>
                  <div className="workflow-line" />
                  <div className="workflow-step"><b>2</b><div><strong>專家審查</strong><p>核對來源、客語用詞與敘事脈絡，留下審查意見。</p></div></div>
                  <div className="workflow-line" />
                  <div className="workflow-step"><b>3</b><div><strong>版本定稿或回復</strong><p>通過後成為正式知識；未通過則回復上一個通過版本。</p></div></div>
                </div>
              </div>
            </section>
          ) : null}

          {activeView === "upload" ? (
            <section className="workspace-view">
              <header className="workspace-hero">
                <span className="eyebrow">STRUCTURED + UNSTRUCTURED</span>
                <h1>把研究資料，<em>放進會回答的知識庫。</em></h1>
                <p>CSV 保留欄位關係，PDF 抽取全文內容；原檔與檢索片段分開保存，讓每次回答可追溯來源。</p>
              </header>
              <div className="upload-layout">
                <form className="drop-panel" onSubmit={uploadFile}>
                  <input ref={fileRef} id="knowledge-file" name="file" type="file" accept=".csv,.pdf,text/csv,application/pdf" required />
                  <label htmlFor="knowledge-file" className="drop-zone">
                    <span className="upload-mark" aria-hidden="true">↑</span>
                    <h2>選擇 CSV 或 PDF</h2>
                    <p>也可以把檔案拖曳到這裡</p>
                    <small>單檔上限 10 MB</small>
                  </label>
                  <button className="primary-action full" type="submit" disabled={uploading}>{uploading ? "正在抽取與切分…" : "開始匯入知識"}</button>
                </form>
                <div className="format-notes">
                  <article>
                    <span className="format-code">CSV</span>
                    <div><h3>結構化資料</h3><p>讀取標題列與每筆欄位值，轉為帶欄名的知識片段。</p><ul><li>客語詞彙表</li><li>田調清冊</li><li>人物／地名資料</li></ul></div>
                  </article>
                  <article>
                    <span className="format-code pdf">PDF</span>
                    <div><h3>非結構化文件</h3><p>抽取可選取的文字層，依語意長度切分後加入檢索。</p><ul><li>研究報告</li><li>期刊論文</li><li>文史出版品</li></ul></div>
                  </article>
                  <div className="privacy-strip"><b>原檔保存</b><span>R2</span><i>→</i><b>文字片段</b><span>D1</span><i>→</i><b>HakkaGPT</b><span>RAG</span></div>
                </div>
              </div>
            </section>
          ) : null}

          {activeView === "review" ? (
            <section className="workspace-view">
              <header className="workspace-hero review-hero">
                <div><span className="eyebrow">EDITORIAL REVIEW DESK</span><h1>讓開放共創，<em>也有可信的落款。</em></h1><p>逐筆核對來源與內容。拒絕修訂後，該版本立即停止參與查詢。</p></div>
                <div className="review-total"><strong>{reviewEntries.length}</strong><span>待審詞條</span></div>
              </header>
              {!status.reviewer ? <div className="permission-note">目前為檢視模式；審查按鈕僅對已授權帳號開放。</div> : null}
              <div className="review-list">
                {reviewEntries.length ? reviewEntries.map((entry, index) => (
                  <article className="review-card" key={entry.id}>
                    <div className="review-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="review-content">
                      <div className="review-meta"><b>共編待審</b><span>{new Date(entry.created_at).toLocaleDateString("zh-TW")}</span><span>{entry.author_email}</span></div>
                      <h2>{entry.term}</h2>
                      <h3>{entry.summary}</h3>
                      <p>{entry.content}</p>
                      {entry.source_url ? <a href={entry.source_url} target="_blank" rel="noreferrer">核對參考來源 ↗</a> : <span className="no-source">未附外部來源</span>}
                    </div>
                    <div className="review-actions">
                      <label>審查備註<textarea rows={3} value={reviewNotes[entry.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder="補充採用或退回原因…" /></label>
                      <button type="button" className="approve" disabled={!status.reviewer || reviewLoading === entry.id} onClick={() => review(entry.id, "approve")}>通過並定稿</button>
                      <button type="button" className="reject" disabled={!status.reviewer || reviewLoading === entry.id} onClick={() => review(entry.id, "reject")}>退回此版本</button>
                    </div>
                  </article>
                )) : (
                  <div className="empty-state"><span>✓</span><h2>目前沒有待審詞條</h2><p>新的公眾共編送出後，會依時間順序出現在這裡。</p></div>
                )}
              </div>
            </section>
          ) : null}
        </main>

        <footer className="site-footer">
          <div className="footer-mark"><span>客天光</span><small>HAKKA KNOWLEDGE AI</small></div>
          <div className="footer-copy">
            <p><strong>本系統「HakkaGPT：結合RAG與大型語言模型之客家知識AI專家對話系統」由 客家委員會 補助建置。</strong>本系統所提供之客家知識內容、AI 對話及相關數位服務，目的在促進客家知識傳播、文化推廣、教育應用與學術研究。</p>
            <p><strong>補助單位：客家委員會　執行單位：國立聯合大學客家研究學院　系統建置：智慧客家實驗室</strong></p>
          </div>
        </footer>
      </div>
    </div>
  );
}
