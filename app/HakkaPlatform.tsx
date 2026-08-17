"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type View = "chat" | "contribute" | "upload" | "admin";
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
  storageConnected: boolean;
  storageLabel: string;
  googleDriveConnected: boolean;
  adminConfigured?: boolean;
};
type AdminEntry = {
  id: string;
  term: string;
  summary: string;
  content: string;
  source_url: string | null;
  status: "pending" | "approved" | "rejected";
  author_email: string;
  reviewer_email: string | null;
  review_note: string | null;
  created_at: number;
  reviewed_at: number | null;
};
type UploadPreview = {
  file: File;
  kind: "csv" | "pdf";
  rows?: string[][];
  objectUrl?: string;
};

const navItems: Array<{ id: View; label: string; kicker: string; glyph: string }> = [
  { id: "chat", label: "智識問答", kicker: "ASK", glyph: "光" },
  { id: "contribute", label: "共創詞條", kicker: "EDIT", glyph: "編" },
  { id: "upload", label: "知識匯入", kicker: "RAG", glyph: "入" },
  { id: "admin", label: "管理後台", kicker: "ADMIN", glyph: "管" },
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

function adminStatusLabel(status: AdminEntry["status"]) {
  if (status === "pending") return "待審";
  if (status === "approved") return "已通過";
  return "未通過";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function csvPreview(text: string, limit = 8) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length && rows.length < limit; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (rows.length < limit && (cell || row.length)) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}

export function HakkaPlatform() {
  const [activeView, setActiveView] = useState<View>("chat");
  const [status, setStatus] = useState<StatusData>({
    apiConnected: false,
    entryCount: 0,
    documentCount: 0,
    pendingCount: 0,
    reviewer: false,
    storageConnected: false,
    storageLabel: "尚未連線",
    googleDriveConnected: false,
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
  const [adminEntries, setAdminEntries] = useState<AdminEntry[]>([]);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminConfigured, setAdminConfigured] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [adminBusy, setAdminBusy] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<UploadPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [statusResponse, sessionResponse] = await Promise.all([
      fetch("/api/status", { cache: "no-store" }),
      fetch("/api/admin/session", { cache: "no-store" }),
    ]);
    if (statusResponse.ok) setStatus(await statusResponse.json());
    if (sessionResponse.ok) {
      const session = (await sessionResponse.json()) as { authenticated: boolean; configured: boolean };
      setAdminAuthenticated(session.authenticated);
      setAdminConfigured(session.configured);
      setStatus((current) => ({ ...current, reviewer: session.authenticated }));
      if (session.authenticated) {
        const entriesResponse = await fetch("/api/admin/entries", { cache: "no-store" });
        if (entriesResponse.ok) {
          const data = (await entriesResponse.json()) as { entries: AdminEntry[] };
          setAdminEntries(data.entries);
          setSelectedEntryIds((current) => new Set([...current].filter((id) =>
            data.entries.some((entry) => entry.id === id),
          )));
        }
      } else {
        setAdminEntries([]);
        setSelectedEntryIds(new Set());
      }
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setNotice("平台狀態暫時無法更新"));
  }, [refresh]);

  useEffect(() => {
    const objectUrl = uploadPreview?.objectUrl;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uploadPreview?.objectUrl]);

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

  async function prepareUploadPreview(file?: File) {
    if (!file) {
      setUploadPreview(null);
      return;
    }
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "csv" && extension !== "pdf") {
      setUploadPreview(null);
      setNotice("目前只接受 CSV 或 PDF 檔案");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadPreview(null);
      setNotice("單一檔案不可超過 10 MB");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setNotice("");
    if (extension === "csv") {
      const text = await file.slice(0, 256 * 1024).text();
      setUploadPreview({ file, kind: "csv", rows: csvPreview(text) });
    } else {
      setUploadPreview({ file, kind: "pdf", objectUrl: URL.createObjectURL(file) });
    }
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = uploadPreview?.file;
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
        storage?: "google-drive" | "r2";
      };
      if (!response.ok) throw new Error(data.error || "檔案匯入失敗");
      const detail = data.pageCount
        ? `${data.pageCount} 頁`
        : `${data.rowCount || 0} 筆資料列`;
      const destination = data.storage === "google-drive" ? "Google Drive" : "平台檔案空間";
      setNotice(`知識匯入完成：原檔已存入${destination}，${detail}，建立 ${data.chunkCount} 個可檢索片段。`);
      event.currentTarget.reset();
      setUploadPreview(null);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "檔案匯入失敗");
    } finally {
      setUploading(false);
    }
  }

  async function loginAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminPassword || adminBusy) return;
    setAdminBusy(true);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "管理者登入失敗");
      setAdminPassword("");
      setNotice("管理者登入成功");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "管理者登入失敗");
    } finally {
      setAdminBusy(false);
    }
  }

  async function logoutAdmin() {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAdminAuthenticated(false);
    setAdminEntries([]);
    setSelectedEntryIds(new Set());
    setNotice("已登出管理後台");
  }

  function toggleEntry(id: string) {
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelectedEntries() {
    const ids = [...selectedEntryIds];
    if (!ids.length || adminBusy) return;
    if (!window.confirm(`確定永久刪除選取的 ${ids.length} 筆新增詞條？`)) return;
    setAdminBusy(true);
    try {
      const response = await fetch("/api/admin/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await response.json()) as { deleted?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "資料刪除失敗");
      setNotice(`已刪除 ${data.deleted || ids.length} 筆新增詞條`);
      setSelectedEntryIds(new Set());
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "資料刪除失敗");
    } finally {
      setAdminBusy(false);
    }
  }

  async function exportEntries() {
    if (adminBusy) return;
    setAdminBusy(true);
    try {
      const response = await fetch("/api/admin/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedEntryIds] }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "資料匯出失敗");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ketiengong-entries-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(selectedEntryIds.size ? `已下載 ${selectedEntryIds.size} 筆詞條` : "已下載全部新增詞條");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "資料匯出失敗");
    } finally {
      setAdminBusy(false);
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
              {item.id === "admin" && status.pendingCount > 0 ? (
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
                <p>CSV 保留欄位關係，PDF 抽取全文內容；原檔與檢索索引保存到指定的 Google Drive 資料夾，讓每次回答可追溯來源。</p>
              </header>
              <div className="upload-layout">
                <form className="drop-panel" onSubmit={uploadFile}>
                  <input
                    ref={fileRef}
                    id="knowledge-file"
                    name="file"
                    type="file"
                    accept=".csv,.pdf,text/csv,application/pdf"
                    required
                    onChange={(event) => prepareUploadPreview(event.target.files?.[0]).catch(() =>
                      setNotice("無法顯示檔案預覽"),
                    )}
                  />
                  <label htmlFor="knowledge-file" className="drop-zone">
                    <span className="upload-mark" aria-hidden="true">↑</span>
                    <h2>{uploadPreview ? "重新選擇檔案" : "選擇 CSV 或 PDF"}</h2>
                    <p>{uploadPreview ? "目前檔案已載入預覽" : "點選這裡瀏覽裝置中的檔案"}</p>
                    <small>單檔上限 10 MB</small>
                  </label>
                  {uploadPreview ? (
                    <section className="file-selection" aria-live="polite">
                      <header className="file-preview-head">
                        <div><b>{uploadPreview.file.name}</b><span>{uploadPreview.kind.toUpperCase()} · {formatBytes(uploadPreview.file.size)}</span></div>
                        <strong>已選取，請確認內容</strong>
                      </header>
                      {uploadPreview.kind === "csv" ? (
                        uploadPreview.rows?.length ? (
                          <div className="preview-table-wrap">
                            <table>
                              <tbody>
                                {uploadPreview.rows.map((row, rowIndex) => (
                                  <tr key={`preview-${rowIndex}`}>
                                    {row.map((cell, cellIndex) => rowIndex === 0
                                      ? <th key={`${rowIndex}-${cellIndex}`}>{cell}</th>
                                      : <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <small>顯示前 {uploadPreview.rows.length} 列，傳送時會處理完整檔案</small>
                          </div>
                        ) : <p className="preview-empty">CSV 目前沒有可預覽的資料列</p>
                      ) : (
                        <iframe className="pdf-preview" src={uploadPreview.objectUrl} title={`${uploadPreview.file.name} 預覽`} />
                      )}
                    </section>
                  ) : null}
                  <button className="primary-action full" type="submit" disabled={uploading || !uploadPreview}>
                    {uploading ? "正在抽取與切分…" : "確認內容並傳送"}
                  </button>
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
                  <div className="privacy-strip"><b>原檔與索引</b><span>{status.storageLabel}</span><i>→</i><b>知識檢索</b><span>RAG</span><i>→</i><b>回答</b><span>HakkaGPT</span></div>
                </div>
              </div>
            </section>
          ) : null}

          {activeView === "admin" ? (
            <section className="workspace-view">
              <header className="workspace-hero review-hero">
                <div><span className="eyebrow">KNOWLEDGE ADMINISTRATION</span><h1>每一筆共創，<em>都有清楚的去向。</em></h1><p>管理者可審查、刪除或批次下載使用者新增的詞條資料。</p></div>
                <div className="review-total"><strong>{adminEntries.filter((entry) => entry.status === "pending").length}</strong><span>待審詞條</span></div>
              </header>
              {!adminAuthenticated ? (
                <form className="admin-login" onSubmit={loginAdmin}>
                  <div><span className="eyebrow">ADMIN SIGN IN</span><h2>登入管理後台</h2><p>管理者密碼只會送至伺服器驗證，瀏覽器不會保存明文。</p></div>
                  {!adminConfigured ? <div className="permission-note">尚未設定 ADMIN 環境變數，請先在部署平台完成設定。</div> : null}
                  <label htmlFor="admin-password">管理者密碼</label>
                  <div className="admin-login-row">
                    <input id="admin-password" type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="輸入管理者密碼" required />
                    <button className="primary-action" type="submit" disabled={adminBusy || !adminConfigured}>登入後台 <b>↗</b></button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <input
                        type="checkbox"
                        checked={adminEntries.length > 0 && selectedEntryIds.size === adminEntries.length}
                        onChange={(event) => setSelectedEntryIds(event.target.checked
                          ? new Set(adminEntries.map((entry) => entry.id))
                          : new Set())}
                      />
                      全選 {adminEntries.length} 筆
                    </label>
                    <span>{selectedEntryIds.size ? `已選 ${selectedEntryIds.size} 筆` : "未選取時會下載全部資料"}</span>
                    <div>
                      <button type="button" onClick={exportEntries} disabled={adminBusy || !adminEntries.length}>批次下載 CSV</button>
                      <button type="button" className="danger" onClick={deleteSelectedEntries} disabled={adminBusy || !selectedEntryIds.size}>刪除選取資料</button>
                      <button type="button" onClick={logoutAdmin}>登出</button>
                    </div>
                  </div>
                  <div className="review-list">
                    {adminEntries.length ? adminEntries.map((entry, index) => (
                      <article className={selectedEntryIds.has(entry.id) ? "review-card admin-card selected" : "review-card admin-card"} key={entry.id}>
                        <div className="admin-selector">
                          <input type="checkbox" checked={selectedEntryIds.has(entry.id)} onChange={() => toggleEntry(entry.id)} aria-label={`選取 ${entry.term}`} />
                          <span>{String(index + 1).padStart(2, "0")}</span>
                        </div>
                        <div className="review-content">
                          <div className="review-meta"><b className={`entry-state ${entry.status}`}>{adminStatusLabel(entry.status)}</b><span>{new Date(entry.created_at).toLocaleString("zh-TW")}</span><span>{entry.author_email}</span></div>
                          <h2>{entry.term}</h2>
                          <h3>{entry.summary}</h3>
                          <p>{entry.content}</p>
                          {entry.source_url ? <a href={entry.source_url} target="_blank" rel="noreferrer">核對參考來源 ↗</a> : <span className="no-source">未附外部來源</span>}
                        </div>
                        <div className="review-actions">
                          {entry.status === "pending" ? (
                            <>
                              <label>審查備註<textarea rows={3} value={reviewNotes[entry.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder="補充採用或退回原因…" /></label>
                              <button type="button" className="approve" disabled={reviewLoading === entry.id} onClick={() => review(entry.id, "approve")}>通過並定稿</button>
                              <button type="button" className="reject" disabled={reviewLoading === entry.id} onClick={() => review(entry.id, "reject")}>退回此版本</button>
                            </>
                          ) : (
                            <div className="review-result"><b>{adminStatusLabel(entry.status)}</b><p>{entry.review_note || "未填審查備註"}</p>{entry.reviewed_at ? <small>{new Date(entry.reviewed_at).toLocaleString("zh-TW")}</small> : null}</div>
                          )}
                        </div>
                      </article>
                    )) : (
                      <div className="empty-state"><span>✓</span><h2>目前沒有新增詞條</h2><p>使用者送出共編詞條後，會依時間順序出現在這裡。</p></div>
                    )}
                  </div>
                </>
              )}
            </section>
          ) : null}
        </main>

        <footer className="site-footer">
          <div className="footer-mark"><span>客天光</span><small>HAKKA KNOWLEDGE AI</small></div>
          <div className="footer-copy">
            <p><strong>本系統「HakkaGPT：結合RAG與大型語言模型之客家知識AI專家對話系統」由 客家委員會 補助建置。</strong>本系統所提供之客家知識內容、AI 對話及相關數位服務，目的在促進客家知識傳播、文化推廣、教育應用與學術研究。</p>
            <p><strong>補助單位：客家委員會{"\u3000"}執行單位：國立聯合大學客家研究學院{"\u3000"}系統建置：智慧客家實驗室</strong></p>
          </div>
        </footer>
      </div>
    </div>
  );
}
