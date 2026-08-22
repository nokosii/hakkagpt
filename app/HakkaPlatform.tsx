"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { KnowledgeGraphPanel } from "@/app/KnowledgeGraph";
import type {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from "@/lib/knowledge-graph";

type View = "chat" | "contribute" | "upload" | "governance" | "admin";
type Dialect = "未標示" | "四縣" | "海陸" | "大埔" | "饒平" | "詔安" | "南四縣";
type AccessLevel = "public" | "community" | "restricted";
type ReviewGateKey = "groundedness" | "citationFidelity" | "dialectIntegrity" | "culturalSafety" | "scopeDiscipline" | "literaryIntegrity";
type ReviewGates = Record<ReviewGateKey, boolean>;
type Governance = {
  dialect: Dialect;
  rightsHolder: string;
  rightsBasis: string;
  license: string;
  accessLevel: AccessLevel;
  communityBenefit: string;
  consentConfirmed: boolean;
};
type Source = {
  id: string;
  title: string;
  kind: "entry" | "document";
  status: "pending" | "approved" | "ready";
  excerpt: string;
  sourceUrl?: string | null;
  dialect: Dialect;
  rightsHolder: string;
  rightsBasis: string;
  license: string;
  accessLevel: AccessLevel;
  communityBenefit: string;
};
type ChatMessage = { role: "user" | "assistant"; text: string; sources?: Source[]; evidenceState?: string; unresolvedQuestion?: string };
type StatusData = {
  apiConnected: boolean;
  graphEnabled?: boolean;
  entryCount: number;
  documentCount: number;
  pendingCount: number;
  reviewer: boolean;
  storageConnected: boolean;
  storageLabel: string;
  googleDriveConnected: boolean;
  adminConfigured?: boolean;
  dialectCoverage?: Record<Dialect, number>;
  accessCounts?: Record<AccessLevel, number>;
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
  governance: Governance;
  review_gates: ReviewGates;
};
type AdminDocument = {
  id: string;
  file_name: string;
  file_type: "csv" | "pdf";
  byte_size: number;
  page_count: number | null;
  row_count: number | null;
  chunk_count: number;
  status: "pending" | "approved" | "rejected";
  owner_email: string;
  created_at: number;
  reviewer_email: string | null;
  review_note: string | null;
  reviewed_at: number | null;
  governance: Governance;
  review_gates: ReviewGates;
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
  { id: "governance", label: "知識治理", kicker: "CARE", glyph: "治" },
  { id: "admin", label: "管理後台", kicker: "ADMIN", glyph: "管" },
];

const dialects: Dialect[] = ["未標示", "四縣", "海陸", "大埔", "饒平", "詔安", "南四縣"];
const reviewGateLabels: Record<ReviewGateKey, string> = {
  groundedness: "內容有證據支持",
  citationFidelity: "來源與權利資訊正確",
  dialectIntegrity: "腔別用詞品質合宜",
  culturalSafety: "文化意義與禁忌受尊重",
  scopeDiscipline: "資料不足時能克制與轉介",
  literaryIntegrity: "無抄襲或作者風格仿作",
};
const emptyReviewGates = (): ReviewGates => ({
  groundedness: false,
  citationFidelity: false,
  dialectIntegrity: false,
  culturalSafety: false,
  scopeDiscipline: false,
  literaryIntegrity: false,
});

function accessLabel(level: AccessLevel) {
  if (level === "community") return "社群限定";
  if (level === "restricted") return "受限保存";
  return "公開使用";
}

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
  const [confirmedUnresolved, setConfirmedUnresolved] = useState<Record<number, boolean>>({});
  const [unresolvedBusyIndex, setUnresolvedBusyIndex] = useState<number | null>(null);
  const [unresolvedActions, setUnresolvedActions] = useState<Record<number, "editing" | "queued">>({});
  const [contributionSeed, setContributionSeed] = useState("");
  const [latestSources, setLatestSources] = useState<Source[]>([]);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphRootQuestion, setGraphRootQuestion] = useState("");
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);
  const [graphExpansionCounts, setGraphExpansionCounts] = useState<Record<string, number>>({});
  const graphExpansionLocksRef = useRef(new Set<string>());
  const [notice, setNotice] = useState("");
  const [adminEntries, setAdminEntries] = useState<AdminEntry[]>([]);
  const [adminDocuments, setAdminDocuments] = useState<AdminDocument[]>([]);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminConfigured, setAdminConfigured] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  const [adminBusy, setAdminBusy] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewGates, setReviewGates] = useState<Record<string, ReviewGates>>({});
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
        const [entriesResponse, documentsResponse] = await Promise.all([
          fetch("/api/admin/entries", { cache: "no-store" }),
          fetch("/api/admin/documents", { cache: "no-store" }),
        ]);
        if (entriesResponse.ok) {
          const data = (await entriesResponse.json()) as { entries: AdminEntry[] };
          setAdminEntries(data.entries);
          setSelectedEntryIds((current) => new Set([...current].filter((id) =>
            data.entries.some((entry) => entry.id === id),
          )));
        }
        if (documentsResponse.ok) {
          const data = (await documentsResponse.json()) as { documents: AdminDocument[] };
          setAdminDocuments(data.documents);
          setSelectedDocumentIds((current) => new Set([...current].filter((id) =>
            data.documents.some((document) => document.id === id),
          )));
        }
      } else {
        setAdminEntries([]);
        setAdminDocuments([]);
        setSelectedEntryIds(new Set());
        setSelectedDocumentIds(new Set());
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
    setLatestSources([]);
    setKnowledgeGraph(null);
    setGraphRootQuestion(nextQuestion);
    setGraphExpansionCounts({});
    graphExpansionLocksRef.current.clear();
    setGraphLoading(true);
    setMessages((current) => [...current, { role: "user", text: nextQuestion }]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion }),
      });
      const data = (await response.json()) as {
        answer?: string;
        sources?: Source[];
        error?: string;
        evidenceState?: string;
        graph?: KnowledgeGraph;
      };
      if (!response.ok || !data.answer) throw new Error(data.error || "查詢失敗");
      const sources = data.sources || [];
      setLatestSources(sources);
      setKnowledgeGraph(data.graph || null);
      setMessages((current) => [...current, {
        role: "assistant",
        text: data.answer!,
        sources,
        evidenceState: data.evidenceState,
        unresolvedQuestion: data.evidenceState === "model-only" ? nextQuestion : undefined,
      }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: error instanceof Error ? error.message : "查詢失敗，請稍後再試。" },
      ]);
    } finally {
      setAsking(false);
      setGraphLoading(false);
    }
  }

  function beginUnresolvedContribution(index: number, unresolvedQuestion: string) {
    if (!confirmedUnresolved[index]) return;
    setContributionSeed(unresolvedQuestion);
    setUnresolvedActions((current) => ({ ...current, [index]: "editing" }));
    setActiveView("contribute");
  }

  async function queueUnresolvedQuestion(index: number, unresolvedQuestion: string) {
    if (!confirmedUnresolved[index] || unresolvedBusyIndex !== null) return;
    setUnresolvedBusyIndex(index);
    try {
      const response = await fetch("/api/unresolved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: unresolvedQuestion, confirmedHakkaRelated: true }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "待解問題儲存失敗");
      setUnresolvedActions((current) => ({ ...current, [index]: "queued" }));
      setNotice("已列為待解決之客家相關問題，後續可由管理者審查、補充或刪除。");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "待解問題儲存失敗");
    } finally {
      setUnresolvedBusyIndex(null);
    }
  }

  async function expandGraph(focus: KnowledgeGraphNode) {
    if (
      !knowledgeGraph ||
      expandingNodeId ||
      graphExpansionCounts[focus.id] ||
      graphExpansionLocksRef.current.has(focus.id)
    ) return;
    const iteration = (graphExpansionCounts[focus.id] || 0) + 1;
    graphExpansionLocksRef.current.add(focus.id);
    let expansionSucceeded = false;
    setExpandingNodeId(focus.id);
    try {
      const response = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          focus,
          rootQuestion: graphRootQuestion,
          existingLabels: knowledgeGraph.nodes.map((node) => node.label),
          dialect: focus.dialect,
          iteration,
        }),
      });
      const data = (await response.json()) as { nodes?: KnowledgeGraphNode[]; edges?: KnowledgeGraphEdge[]; error?: string };
      if (!response.ok || !data.nodes?.length) throw new Error(data.error || "這個節點暫時無法繼續延伸");
      setKnowledgeGraph((current) => {
        if (!current) return current;
        const nodes = [...current.nodes];
        const labels = new Map(nodes.map((node) => [node.label.trim().toLocaleLowerCase("zh-Hant"), node.id]));
        const remap = new Map<string, string>();
        for (const node of data.nodes || []) {
          const key = node.label.trim().toLocaleLowerCase("zh-Hant");
          const existingId = labels.get(key);
          if (existingId) {
            remap.set(node.id, existingId);
          } else {
            labels.set(key, node.id);
            remap.set(node.id, node.id);
            nodes.push(node);
          }
        }
        const nodeIds = new Set(nodes.map((node) => node.id));
        const edges = [...current.edges];
        for (const edge of data.edges || []) {
          const source = remap.get(edge.source) || edge.source;
          const target = remap.get(edge.target) || edge.target;
          if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) continue;
          if (edges.some((item) => item.source === source && item.target === target && item.label === edge.label)) continue;
          edges.push({ ...edge, source, target });
        }
        return { ...current, nodes, edges };
      });
      setGraphExpansionCounts((current) => ({ ...current, [focus.id]: iteration }));
      expansionSucceeded = true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "圖譜延伸失敗，請稍後再試");
    } finally {
      if (!expansionSucceeded) graphExpansionLocksRef.current.delete(focus.id);
      setExpandingNodeId(null);
    }
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const originalQuestion = String(form.get("originalQuestion") || "").trim();
    const submittedContent = String(form.get("content") || "").trim();
    const response = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term: form.get("term"),
        summary: form.get("summary"),
        content: originalQuestion ? `問題：${originalQuestion}\n\n解答：${submittedContent}` : submittedContent,
        sourceUrl: form.get("sourceUrl"),
        governance: {
          dialect: form.get("dialect"),
          rightsHolder: form.get("rightsHolder"),
          rightsBasis: form.get("rightsBasis"),
          license: form.get("license"),
          accessLevel: form.get("accessLevel"),
          communityBenefit: form.get("communityBenefit"),
          consentConfirmed: form.get("consentConfirmed") === "on",
        },
      }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setNotice(data.error || "詞條送出失敗");
      return;
    }
    formElement.reset();
    setContributionSeed("");
    setNotice("詞條已送出。公開層內容會以待審標示暫行查詢；社群限定與受限內容不會送入公開回答。");
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
    const formElement = event.currentTarget;
    const file = uploadPreview?.file;
    if (!file || uploading) return;
    setUploading(true);
    setNotice("");
    try {
      const form = new FormData(formElement);
      form.set("file", file);
      form.set("consentConfirmed", form.get("consentConfirmed") === "on" ? "true" : "false");
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
      setNotice(`知識匯入完成：原檔已存入${destination}，${detail}，建立 ${data.chunkCount} 個暫行檢索片段，待雙閘門審查。`);
      formElement.reset();
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
    setAdminDocuments([]);
    setSelectedEntryIds(new Set());
    setSelectedDocumentIds(new Set());
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

  function toggleDocument(id: string) {
    setSelectedDocumentIds((current) => {
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

  async function deleteSelectedDocuments() {
    const ids = [...selectedDocumentIds];
    if (!ids.length || adminBusy) return;
    if (!window.confirm(`確定永久刪除選取的 ${ids.length} 份文件、檢索索引與原檔？`)) return;
    setAdminBusy(true);
    try {
      const response = await fetch("/api/admin/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await response.json()) as { deleted?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "文件刪除失敗");
      setNotice(`已刪除 ${data.deleted || ids.length} 份文件、原檔與檢索索引`);
      setSelectedDocumentIds(new Set());
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文件刪除失敗");
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

  async function review(id: string, action: "approve" | "reject", kind: "entry" | "document" = "entry") {
    const reviewKey = kind === "document" ? `document:${id}` : id;
    setReviewLoading(reviewKey);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          kind,
          action,
          note: reviewNotes[reviewKey] || "",
          gates: reviewGates[reviewKey] || emptyReviewGates(),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "審查更新失敗");
      setNotice(action === "approve"
        ? `${kind === "document" ? "文件" : "詞條"}已通過雙閘門，正式納入知識庫。`
        : `${kind === "document" ? "文件" : "詞條"}未通過，已停止作為查詢證據。`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "審查更新失敗");
    } finally {
      setReviewLoading(null);
    }
  }

  function toggleReviewGate(id: string, key: ReviewGateKey) {
    setReviewGates((current) => ({
      ...current,
      [id]: {
        ...(current[id] || emptyReviewGates()),
        [key]: !(current[id] || emptyReviewGates())[key],
      },
    }));
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
                        {message.role === "assistant" ? (
                          <small>{message.evidenceState === "grounded" ? "HakkaGPT + 公開證據" : message.evidenceState === "blocked" ? "文學誠信防護" : message.evidenceState === "model-only" ? "平台證據不足 · HakkaGPT 回答" : "HakkaGPT 一般回答"}</small>
                        ) : <small>提問</small>}
                      </div>
                      <div className="message-body">{message.text}</div>
                      {message.evidenceState === "model-only" && message.unresolvedQuestion ? (
                        <div className="unresolved-followup">
                          <label>
                            <input
                              type="checkbox"
                              checked={Boolean(confirmedUnresolved[index])}
                              onChange={(event) => setConfirmedUnresolved((current) => ({ ...current, [index]: event.target.checked }))}
                            />
                            本題確實與客家相關
                          </label>
                          <p>確認後可自行提供問題與解答，或列入待解清單，協助補足平台知識。</p>
                          <div>
                            <button
                              type="button"
                              disabled={!confirmedUnresolved[index]}
                              onClick={() => beginUnresolvedContribution(index, message.unresolvedQuestion!)}
                            >自行編寫問題及解答</button>
                            <button
                              type="button"
                              disabled={!confirmedUnresolved[index] || unresolvedBusyIndex !== null || unresolvedActions[index] === "queued"}
                              onClick={() => queueUnresolvedQuestion(index, message.unresolvedQuestion!)}
                            >{unresolvedActions[index] === "queued" ? "已列入待解清單" : unresolvedBusyIndex === index ? "正在列入…" : "列為待解決之客家相關問題"}</button>
                          </div>
                        </div>
                      ) : null}
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
                  <div className="ask-settings">
                    <label htmlFor="question">想了解哪一段客家知識？</label>
                  </div>
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
                <KnowledgeGraphPanel
                  graph={knowledgeGraph}
                  loading={graphLoading}
                  expandingNodeId={expandingNodeId}
                  expandedNodeIds={Object.keys(graphExpansionCounts)}
                  onExpand={expandGraph}
                />
                <div className="evidence-section">
                  <div className="rail-heading">
                    <span className="eyebrow">RAG EVIDENCE</span>
                    <h2>這次回答參考了什麼</h2>
                  </div>
                  {latestSources.length ? latestSources.map((source, index) => (
                    <article className="source-card" key={source.id}>
                      <div className="source-top">
                        <span>0{index + 1}</span>
                        <b className={`source-status ${source.status}`}>{statusLabel(source.status)}</b>
                      </div>
                      <h3>{source.title}</h3>
                      <div className="source-governance">{source.dialect !== "未標示" ? <span>{source.dialect}腔</span> : null}<span>{source.rightsHolder}</span><span>{source.rightsBasis}</span></div>
                      <p>{source.excerpt.slice(0, 118)}{source.excerpt.length > 118 ? "…" : ""}</p>
                      <small className="source-license">{source.license} · {accessLabel(source.accessLevel)}</small>
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
                      <li><span>1</span>只取公開存取層</li>
                      <li><span>2</span>保留資料原有腔別</li>
                      <li><span>3</span>揭露來源與審查狀態</li>
                    </ol>
                  </div>
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
                <form key={contributionSeed || "blank-contribution"} className="editor-panel" onSubmit={submitEntry}>
                  <div className="panel-title"><span>01</span><div><h2>{contributionSeed ? "補寫待解問題" : "新增或修訂詞條"}</h2><p>所有欄位都會保留在版本紀錄</p></div></div>
                  {contributionSeed ? <label>客家相關問題<textarea name="originalQuestion" required minLength={2} maxLength={1200} rows={4} defaultValue={contributionSeed} /></label> : null}
                  <label>詞條名稱<input name="term" required minLength={2} maxLength={80} defaultValue={contributionSeed.slice(0, 80)} placeholder="例：新丁粄" /></label>
                  <label>{contributionSeed ? "解答摘要" : "一句摘要"}<input name="summary" required minLength={4} maxLength={240} placeholder={contributionSeed ? "用一句話摘要你的解答" : "用一句話說明這個詞條"} /></label>
                  <label>{contributionSeed ? "完整解答" : "完整內容"}<textarea name="content" required minLength={10} maxLength={12000} rows={9} placeholder={contributionSeed ? "請寫下解答、脈絡、地區差異與相關背景…" : "說明由來、地區差異、使用情境與相關背景…"} /></label>
                  <label>參考來源（選填）<input name="sourceUrl" type="url" placeholder="https://" /></label>
                  <div className="governance-fields">
                    <label>腔別<select name="dialect" required defaultValue="未標示">{dialects.map((dialect) => <option key={dialect}>{dialect}</option>)}</select></label>
                    <label>存取層級<select name="accessLevel" required defaultValue="public"><option value="public">公開使用，可進回答</option><option value="community">社群限定，不進公開回答</option><option value="restricted">受限保存，不進模型</option></select></label>
                    <label>作者／權利持有人<input name="rightsHolder" required maxLength={160} placeholder="姓名、社群或機構" /></label>
                    <label>權利依據<select name="rightsBasis" required defaultValue="本人創作"><option>本人創作</option><option>已取得授權</option><option>公有領域</option><option>合理引用</option><option>待確認</option></select></label>
                    <label>授權條款<input name="license" required maxLength={160} defaultValue="僅供本平台文化、教育與研究使用" /></label>
                    <label>社群利益<input name="communityBenefit" required maxLength={500} defaultValue="客家知識保存、教育與研究" /></label>
                  </div>
                  <label className="consent-row"><input name="consentConfirmed" type="checkbox" required />我確認具備提交與社群使用這份資料的權利，並理解可提出更正或撤回。</label>
                  <div className="form-footer">
                    <span>送出即建立「待審版本」</span>
                    <button className="primary-action" type="submit">送出共編 <b>↗</b></button>
                  </div>
                </form>
                <div className="workflow-panel">
                  <span className="eyebrow">VERSION GOVERNANCE</span>
                  <h2>讓知識流動，<br />也讓社群保有控制。</h2>
                  <div className="workflow-step active"><b>1</b><div><strong>分級發布</strong><p>只有公開層暫行進入 RAG；社群限定與受限資料不進公開回答。</p></div></div>
                  <div className="workflow-line" />
                  <div className="workflow-step"><b>2</b><div><strong>雙閘門審查</strong><p>分別核對技術適切性與文化安全，六項條件不可用平均分掩蓋。</p></div></div>
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
                  <section className="upload-governance">
                    <h3>上傳前先標示資料治理資訊</h3>
                    <div className="governance-fields">
                      <label>腔別<select name="dialect" required defaultValue="未標示">{dialects.map((dialect) => <option key={dialect}>{dialect}</option>)}</select></label>
                      <label>存取層級<select name="accessLevel" required defaultValue="public"><option value="public">公開使用，可進回答</option><option value="community">社群限定，不進公開回答</option><option value="restricted">受限保存，不進模型</option></select></label>
                      <label>作者／權利持有人<input name="rightsHolder" required maxLength={160} placeholder="姓名、社群或機構" /></label>
                      <label>權利依據<select name="rightsBasis" required defaultValue="已取得授權"><option>本人創作</option><option>已取得授權</option><option>公有領域</option><option>合理引用</option><option>待確認</option></select></label>
                      <label>授權條款<input name="license" required maxLength={160} defaultValue="僅供本平台文化、教育與研究使用" /></label>
                      <label>社群利益<input name="communityBenefit" required maxLength={500} defaultValue="客家知識保存、教育與研究" /></label>
                    </div>
                    <label className="consent-row"><input name="consentConfirmed" type="checkbox" required />我確認具備上傳與社群使用此檔案的權利，並同意保留來源與權利資訊。</label>
                  </section>
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
                  <div className="privacy-strip"><b>原檔與治理資訊</b><span>{status.storageLabel}</span><i>→</i><b>公開層過濾</b><span>六腔 RAG</span><i>→</i><b>證據化回答</b><span>HakkaGPT</span></div>
                </div>
              </div>
            </section>
          ) : null}

          {activeView === "governance" ? (
            <section className="workspace-view governance-view">
              <header className="workspace-hero">
                <span className="eyebrow">CARE + OCAP KNOWLEDGE GOVERNANCE</span>
                <h1>不是只讓模型會答，<br /><em>而是讓社群有權決定。</em></h1>
                <p>客天光依集體利益、控制權、責任與倫理管理知識。來源、腔別、作者、權利與審查狀態會跟著證據一起呈現。</p>
              </header>
              <div className="governance-principles">
                <article><span>01</span><h2>社群主權</h2><p>資料提交者必須標示權利依據與社群利益；管理者可更正、退回或刪除資料，受限內容不送進模型。</p></article>
                <article><span>02</span><h2>六腔不平均</h2><p>四縣、海陸、大埔、饒平、詔安與南四縣分別標示。引用資料明確標有腔別時，回答才說明該資料的腔別。</p></article>
                <article><span>03</span><h2>證據可追溯</h2><p>回答旁揭露來源名稱、腔別、權利持有人、授權依據及暫行或正式狀態，不把模型記憶冒充文獻。</p></article>
                <article><span>04</span><h2>文學誠信</h2><p>可協助分析、比較與教學，但拒絕模仿可辨識作者風格的新作，避免 AI 生成內容侵蝕作者權益。</p></article>
              </div>
              <div className="dialect-dashboard">
                <div>
                  <span className="eyebrow">DIALECT COVERAGE</span>
                  <h2>四海大平安，逐腔檢視</h2>
                  <p>以下只呈現資料筆數，不合併成單一平均分。正式研究評估仍須由各腔母語者分別檢核。</p>
                </div>
                <div className="dialect-counts">
                  {dialects.filter((dialect) => dialect !== "未標示").map((dialect) => <div key={dialect}><strong>{status.dialectCoverage?.[dialect] || 0}</strong><span>{dialect}</span></div>)}
                </div>
              </div>
              <div className="double-gate">
                <div><span className="gate-code">A</span><h2>技術適切性</h2><p>查核內容有據、引文忠實、腔別品質與資料不足時的克制。</p></div>
                <i>＋</i>
                <div><span className="gate-code">B</span><h2>文化安全</h2><p>查核文化意義、社群脈絡、權利資訊與文學誠信。</p></div>
                <b>兩閘門皆通過才成為正式版本</b>
              </div>
              <div className="model-boundary">
                <span className="eyebrow">MODEL BOUNDARY</span>
                <h2>目前已落實的平台層與研究中的模型層</h2>
                <div><p><strong>已運作：</strong>社群治理中繼資料、存取分級、六腔感知檢索、證據揭露、雙閘門審查與作者風格仿作防護。</p><p><strong>研究層：</strong>GraphRAG、tokenizer 改造與六腔 LoRA 屬外部模型訓練工作；目前查詢仍由正式 HakkaGPT API 回應，本平台不虛構已完成的模型能力。</p></div>
              </div>
            </section>
          ) : null}

          {activeView === "admin" ? (
            <section className="workspace-view">
              <header className="workspace-hero review-hero">
                <div><span className="eyebrow">KNOWLEDGE ADMINISTRATION</span><h1>每一筆共創，<em>都有清楚的去向。</em></h1><p>管理者可審查、刪除或批次下載使用者新增的詞條資料。</p></div>
                <div className="review-total"><strong>{adminEntries.filter((entry) => entry.status === "pending").length + adminDocuments.filter((document) => document.status === "pending").length}</strong><span>待審資料</span></div>
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
                  <section className="document-admin">
                    <header>
                      <div><span className="eyebrow">DOCUMENT GOVERNANCE</span><h2>匯入文件與原檔</h2><p>公開文件暫行提供查詢；雙閘門通過後才標示為正式證據。刪除會同步移除原檔與索引。</p></div>
                      <div className="document-tools">
                        <label><input type="checkbox" checked={adminDocuments.length > 0 && selectedDocumentIds.size === adminDocuments.length} onChange={(event) => setSelectedDocumentIds(event.target.checked ? new Set(adminDocuments.map((document) => document.id)) : new Set())} />全選文件</label>
                        <button type="button" className="danger" onClick={deleteSelectedDocuments} disabled={adminBusy || !selectedDocumentIds.size}>刪除選取文件</button>
                      </div>
                    </header>
                    <div className="review-list document-list">
                      {adminDocuments.length ? adminDocuments.map((document, index) => {
                        const key = `document:${document.id}`;
                        const currentGates = reviewGates[key] || emptyReviewGates();
                        return (
                          <article className={selectedDocumentIds.has(document.id) ? "review-card admin-card selected" : "review-card admin-card"} key={document.id}>
                            <div className="admin-selector"><input type="checkbox" checked={selectedDocumentIds.has(document.id)} onChange={() => toggleDocument(document.id)} aria-label={`選取 ${document.file_name}`} /><span>{String(index + 1).padStart(2, "0")}</span></div>
                            <div className="review-content">
                              <div className="review-meta"><b className={`entry-state ${document.status}`}>{adminStatusLabel(document.status)}</b><span>{new Date(document.created_at).toLocaleString("zh-TW")}</span><span>{document.owner_email}</span></div>
                              <h2>{document.file_name}</h2>
                              <h3>{document.file_type.toUpperCase()} · {formatBytes(document.byte_size)} · {document.page_count ? `${document.page_count} 頁` : `${document.row_count || 0} 筆資料列`} · {document.chunk_count} 個片段</h3>
                              <div className="entry-governance"><span>腔別：{document.governance.dialect}</span><span>存取：{accessLabel(document.governance.accessLevel)}</span><span>權利持有人：{document.governance.rightsHolder}</span><span>依據：{document.governance.rightsBasis}</span><span>授權：{document.governance.license}</span></div>
                              <p className="community-benefit">社群利益：{document.governance.communityBenefit}</p>
                            </div>
                            <div className="review-actions">
                              {document.status === "pending" ? <>
                                <div className="gate-checklist"><strong>雙閘門六項檢核</strong>{(Object.keys(reviewGateLabels) as ReviewGateKey[]).map((gate) => <label key={gate}><input type="checkbox" checked={currentGates[gate]} onChange={() => toggleReviewGate(key, gate)} />{reviewGateLabels[gate]}</label>)}</div>
                                <label>審查備註<textarea rows={3} value={reviewNotes[key] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [key]: event.target.value }))} placeholder="記錄文件採用、限制或退回原因…" /></label>
                                <button type="button" className="approve" disabled={reviewLoading === key || !Object.values(currentGates).every(Boolean)} onClick={() => review(document.id, "approve", "document")}>雙閘門通過並定稿</button>
                                <button type="button" className="reject" disabled={reviewLoading === key} onClick={() => review(document.id, "reject", "document")}>退回並停止檢索</button>
                              </> : <div className="review-result"><b>{adminStatusLabel(document.status)}</b><p>{document.review_note || "未填審查備註"}</p><small>{Object.values(document.review_gates).filter(Boolean).length} / 6 項檢核通過</small>{document.reviewed_at ? <small>{new Date(document.reviewed_at).toLocaleString("zh-TW")}</small> : null}</div>}
                            </div>
                          </article>
                        );
                      }) : <div className="empty-state compact"><span>入</span><h2>目前沒有匯入文件</h2><p>CSV 或 PDF 上傳後會出現在這裡。</p></div>}
                    </div>
                  </section>
                  <div className="entry-section-title"><span className="eyebrow">ENTRY GOVERNANCE</span><h2>共創詞條</h2></div>
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
                          <div className="entry-governance">
                            <span>腔別：{entry.governance.dialect}</span>
                            <span>存取：{accessLabel(entry.governance.accessLevel)}</span>
                            <span>權利持有人：{entry.governance.rightsHolder}</span>
                            <span>依據：{entry.governance.rightsBasis}</span>
                            <span>授權：{entry.governance.license}</span>
                          </div>
                          <p>{entry.content}</p>
                          <p className="community-benefit">社群利益：{entry.governance.communityBenefit}</p>
                          {entry.source_url ? <a href={entry.source_url} target="_blank" rel="noreferrer">核對參考來源 ↗</a> : <span className="no-source">未附外部來源</span>}
                        </div>
                        <div className="review-actions">
                          {entry.status === "pending" ? (
                            <>
                              <div className="gate-checklist">
                                <strong>雙閘門六項檢核</strong>
                                {(Object.keys(reviewGateLabels) as ReviewGateKey[]).map((key) => (
                                  <label key={key}>
                                    <input type="checkbox" checked={(reviewGates[entry.id] || emptyReviewGates())[key]} onChange={() => toggleReviewGate(entry.id, key)} />
                                    {reviewGateLabels[key]}
                                  </label>
                                ))}
                              </div>
                              <label>審查備註<textarea rows={3} value={reviewNotes[entry.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder="補充採用或退回原因…" /></label>
                              <button type="button" className="approve" disabled={reviewLoading === entry.id || !Object.values(reviewGates[entry.id] || emptyReviewGates()).every(Boolean)} onClick={() => review(entry.id, "approve")}>雙閘門通過並定稿</button>
                              <button type="button" className="reject" disabled={reviewLoading === entry.id} onClick={() => review(entry.id, "reject")}>退回此版本</button>
                            </>
                          ) : (
                            <div className="review-result"><b>{adminStatusLabel(entry.status)}</b><p>{entry.review_note || "未填審查備註"}</p><small>{Object.entries(entry.review_gates).filter(([, passed]) => passed).length} / 6 項檢核通過</small>{entry.reviewed_at ? <small>{new Date(entry.reviewed_at).toLocaleString("zh-TW")}</small> : null}</div>
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
