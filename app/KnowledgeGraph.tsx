"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KnowledgeGraph,
  KnowledgeGraphNode,
  KnowledgeGraphNodeKind,
} from "@/lib/knowledge-graph";

type Point = { x: number; y: number; vx: number; vy: number; pinned: boolean };
type Viewport = { x: number; y: number; scale: number };
type PointerAction = {
  mode: "pan" | "node";
  nodeId?: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
};

type Props = {
  graph: KnowledgeGraph | null;
  loading: boolean;
  expandingNodeId: string | null;
  expandedNodeIds: readonly string[];
  onExpand: (node: KnowledgeGraphNode) => void;
};

const nodeColors: Record<KnowledgeGraphNodeKind, string> = {
  root: "#f2b44d",
  concept: "#91a99b",
  evidence: "#4fb7a0",
  culture: "#d06d4f",
  dialect: "#76a6d8",
  person: "#c89bca",
  place: "#89b86c",
  event: "#d5975a",
};

const kindLabels: Record<KnowledgeGraphNodeKind, string> = {
  root: "中心提問",
  concept: "概念",
  evidence: "RAG 證據",
  culture: "文化",
  dialect: "腔別",
  person: "人物",
  place: "地方",
  event: "事件",
};

function radius(node: KnowledgeGraphNode) {
  if (node.kind === "root") return 17;
  if (node.kind === "evidence") return 11;
  return 9 + node.impact / 22;
}

function shortLabel(value: string) {
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

export function KnowledgeGraphPanel({ graph, loading, expandingNodeId, expandedNodeIds, onExpand }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positionsRef = useRef(new Map<string, Point>());
  const pointerRef = useRef<PointerAction | null>(null);
  const [size, setSize] = useState({ width: 420, height: 470 });
  const [viewport, setViewport] = useState<Viewport>({ x: 210, y: 230, scale: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const selectedNode = graph?.nodes.find((node) => node.id === selectedId)
    || graph?.nodes.find((node) => node.id === graph.rootId)
    || null;
  const activeSelectedId = selectedNode?.id || null;
  const selectedExpanded = selectedNode ? expandedNodeIds.includes(selectedNode.id) : false;

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(260, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(360, Math.floor(entry.contentRect.height));
      setSize({ width: nextWidth, height: nextHeight });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!graph) {
      positionsRef.current.clear();
      return;
    }
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const id of positionsRef.current.keys()) {
      if (!ids.has(id)) positionsRef.current.delete(id);
    }
    const angleStep = Math.PI * (3 - Math.sqrt(5));
    graph.nodes.forEach((node, index) => {
      if (positionsRef.current.has(node.id)) return;
      const parentEdge = graph.edges.find((edge) => edge.target === node.id && positionsRef.current.has(edge.source));
      const parent = parentEdge ? positionsRef.current.get(parentEdge.source) : undefined;
      const angle = angleStep * (index + 1) + node.depth * 0.31;
      const distance = parent ? 34 + Math.random() * 16 : 66 + Math.sqrt(index + 1) * 34;
      positionsRef.current.set(node.id, {
        x: (parent?.x || 0) + Math.cos(angle) * distance,
        y: (parent?.y || 0) + Math.sin(angle) * distance,
        vx: Math.cos(angle) * 0.6,
        vy: Math.sin(angle) * 0.6,
        pinned: false,
      });
    });
  }, [graph]);

  const fitGraph = useCallback(() => {
    if (!graph?.nodes.length) return;
    const points = graph.nodes.map((node) => positionsRef.current.get(node.id)).filter(Boolean) as Point[];
    if (!points.length) return;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const graphWidth = Math.max(120, maxX - minX + 100);
    const graphHeight = Math.max(120, maxY - minY + 100);
    const scale = Math.max(0.35, Math.min(1.35, Math.min(size.width / graphWidth, size.height / graphHeight)));
    setViewport({
      x: size.width / 2 - ((minX + maxX) / 2) * scale,
      y: size.height / 2 - ((minY + maxY) / 2) * scale,
      scale,
    });
  }, [graph, size]);

  async function toggleFullscreen() {
    const panel = panelRef.current;
    if (!panel) return;
    if (document.fullscreenElement === panel) {
      await document.exitFullscreen();
    } else {
      await panel.requestFullscreen();
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(size.width * pixelRatio);
    canvas.height = Math.floor(size.height * pixelRatio);
    let frame = 0;
    let energy = 1;

    function draw() {
      if (!context || !graph) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      const gradient = context.createRadialGradient(size.width * 0.46, size.height * 0.38, 5, size.width * 0.5, size.height * 0.5, size.width * 0.78);
      gradient.addColorStop(0, "#172744");
      gradient.addColorStop(0.62, "#101a31");
      gradient.addColorStop(1, "#090f1e");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size.width, size.height);

      context.save();
      context.translate(viewport.x, viewport.y);
      context.scale(viewport.scale, viewport.scale);

      for (const edge of graph.edges) {
        const source = positionsRef.current.get(edge.source);
        const target = positionsRef.current.get(edge.target);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const curve = Math.min(30, Math.hypot(dx, dy) * 0.13);
        const normalX = -dy / Math.max(1, Math.hypot(dx, dy));
        const normalY = dx / Math.max(1, Math.hypot(dx, dy));
        const controlX = (source.x + target.x) / 2 + normalX * curve;
        const controlY = (source.y + target.y) / 2 + normalY * curve;
        const emphasized = edge.source === activeSelectedId || edge.target === activeSelectedId;
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.quadraticCurveTo(controlX, controlY, target.x, target.y);
        context.strokeStyle = emphasized ? "rgba(242,180,77,.76)" : "rgba(125,179,167,.28)";
        context.lineWidth = (emphasized ? 1.7 : 0.7) / viewport.scale;
        context.stroke();

        if (viewport.scale > 0.55 && emphasized) {
          context.fillStyle = "rgba(242,226,190,.82)";
          context.font = `${9 / viewport.scale}px sans-serif`;
          context.textAlign = "center";
          context.fillText(edge.label, controlX, controlY - 5 / viewport.scale);
        }
      }

      const elapsed = performance.now() / 700;
      for (const node of graph.nodes) {
        const point = positionsRef.current.get(node.id);
        if (!point) continue;
        const nodeRadius = radius(node);
        const active = node.id === activeSelectedId || node.id === hoverId;
        const expanding = node.id === expandingNodeId;
        const pulse = expanding ? 5 + Math.sin(elapsed * 4) * 3 : 0;
        context.save();
        context.shadowBlur = active || expanding ? 24 + pulse : 10;
        context.shadowColor = nodeColors[node.kind];
        context.beginPath();
        context.arc(point.x, point.y, nodeRadius + pulse, 0, Math.PI * 2);
        context.fillStyle = expanding ? "rgba(242,180,77,.18)" : active ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.055)";
        context.fill();
        context.lineWidth = (active ? 2.2 : 1.2) / viewport.scale;
        context.strokeStyle = nodeColors[node.kind];
        context.stroke();
        context.beginPath();
        context.arc(point.x, point.y, Math.max(3.5, nodeRadius * .42), 0, Math.PI * 2);
        context.fillStyle = nodeColors[node.kind];
        context.fill();
        context.restore();

        if (viewport.scale > 0.42 || node.kind === "root") {
          context.font = `${node.kind === "root" ? 11 : 9.5}px "Noto Sans TC", sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "top";
          context.fillStyle = active ? "#fff4d8" : "rgba(244,239,228,.9)";
          context.fillText(shortLabel(node.label), point.x, point.y + nodeRadius + 7);
        }
      }
      context.restore();

      context.fillStyle = "rgba(242,180,77,.55)";
      for (let index = 0; index < 34; index += 1) {
        const x = (index * 97 + 23) % size.width;
        const y = (index * 151 + 41) % size.height;
        context.fillRect(x, y, index % 5 === 0 ? 1.4 : .7, index % 5 === 0 ? 1.4 : .7);
      }
    }

    function simulate() {
      const nodes = graph.nodes;
      if (energy > 0.012) {
        for (let left = 0; left < nodes.length; left += 1) {
          const a = positionsRef.current.get(nodes[left].id);
          if (!a) continue;
          for (let right = left + 1; right < nodes.length; right += 1) {
            const b = positionsRef.current.get(nodes[right].id);
            if (!b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const squared = Math.max(90, dx * dx + dy * dy);
            const force = Math.min(1.7, 1250 / squared) * energy;
            const distance = Math.sqrt(squared);
            a.vx -= dx / distance * force;
            a.vy -= dy / distance * force;
            b.vx += dx / distance * force;
            b.vy += dy / distance * force;
          }
        }
        for (const edge of graph.edges) {
          const source = positionsRef.current.get(edge.source);
          const target = positionsRef.current.get(edge.target);
          if (!source || !target) continue;
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const desired = 72 + Math.min(92, distance * .03) + Math.abs((graph.nodes.find((node) => node.id === edge.target)?.depth || 0) * 7);
          const force = (distance - desired) * .007 * energy;
          source.vx += dx / distance * force;
          source.vy += dy / distance * force;
          target.vx -= dx / distance * force;
          target.vy -= dy / distance * force;
        }
        for (const node of nodes) {
          const point = positionsRef.current.get(node.id);
          if (!point || point.pinned) continue;
          point.vx += -point.x * .0007 * energy;
          point.vy += -point.y * .0007 * energy;
          point.vx *= .88;
          point.vy *= .88;
          point.x += point.vx;
          point.y += point.vy;
        }
        energy *= .983;
      }
      draw();
      frame = requestAnimationFrame(simulate);
    }
    simulate();
    return () => cancelAnimationFrame(frame);
  }, [activeSelectedId, expandingNodeId, graph, hoverId, size, viewport]);

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function nodeAt(screenX: number, screenY: number) {
    if (!graph) return null;
    const worldX = (screenX - viewport.x) / viewport.scale;
    const worldY = (screenY - viewport.y) / viewport.scale;
    return [...graph.nodes].reverse().find((node) => {
      const point = positionsRef.current.get(node.id);
      return point && Math.hypot(point.x - worldX, point.y - worldY) <= radius(node) + 9 / viewport.scale;
    }) || null;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = canvasPoint(event);
    const node = nodeAt(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = {
      mode: node ? "node" : "pan",
      nodeId: node?.id,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      moved: false,
    };
    if (node) {
      setSelectedId(node.id);
      const position = positionsRef.current.get(node.id);
      if (position) position.pinned = true;
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = canvasPoint(event);
    const action = pointerRef.current;
    if (!action) {
      setHoverId(nodeAt(point.x, point.y)?.id || null);
      return;
    }
    const dx = point.x - action.lastX;
    const dy = point.y - action.lastY;
    action.lastX = point.x;
    action.lastY = point.y;
    if (Math.hypot(point.x - action.startX, point.y - action.startY) > 4) action.moved = true;
    if (action.mode === "pan") {
      setViewport((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    } else if (action.nodeId) {
      const position = positionsRef.current.get(action.nodeId);
      if (position) {
        position.x += dx / viewport.scale;
        position.y += dy / viewport.scale;
        position.vx = 0;
        position.vy = 0;
      }
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const action = pointerRef.current;
    pointerRef.current = null;
    if (!action) return;
    if (action.nodeId) {
      const position = positionsRef.current.get(action.nodeId);
      if (position) position.pinned = action.moved;
      if (!action.moved && graph) {
        const node = graph.nodes.find((item) => item.id === action.nodeId);
        if (node && !expandedNodeIds.includes(node.id)) onExpand(node);
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const point = canvasPoint(event);
    setViewport((current) => {
      const nextScale = Math.max(.28, Math.min(2.3, current.scale * Math.exp(-event.deltaY * .0012)));
      const worldX = (point.x - current.x) / current.scale;
      const worldY = (point.y - current.y) / current.scale;
      return { x: point.x - worldX * nextScale, y: point.y - worldY * nextScale, scale: nextScale };
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if ((event.key === "Enter" || event.key === " ") && selectedNode && !selectedExpanded) {
      event.preventDefault();
      onExpand(selectedNode);
    }
    if (event.key === "0") fitGraph();
  }

  return (
    <section ref={panelRef} className="graph-panel" aria-labelledby="knowledge-graph-title">
      <header className="graph-head">
        <div>
          <span className="eyebrow">HAKKA KNOWLEDGE MAP</span>
          <h2 id="knowledge-graph-title">客家圖講</h2>
          <small className="graph-policy">依提問相關度生成</small>
        </div>
        <div className="graph-stats" aria-label="圖譜統計">
          <b>{graph?.nodes.length || 0}</b><span>節點</span>
          <b>{graph?.edges.length || 0}</b><span>連線</span>
        </div>
      </header>

      <div className="graph-stage">
        <canvas
          ref={canvasRef}
          className="graph-canvas"
          tabIndex={0}
          aria-label="互動式客家圖講。點選節點可產生下一層關聯，拖曳背景可平移，滾輪可縮放。"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => setHoverId(null)}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
        />
        {!graph ? (
          <div className={`graph-empty ${loading ? "loading" : ""}`}>
            <span aria-hidden="true">✦</span>
            <b>{loading ? "正在生成客家圖講" : "等待一次提問"}</b>
            <p>{loading ? "回答與圖譜同步整理中" : "送出問題後，可從中心節點一路點選探索。"}</p>
          </div>
        ) : null}
        <div className="graph-toolbar" aria-label="圖譜工具">
          <button type="button" onClick={fitGraph} disabled={!graph} title="顯示全部節點">置中</button>
          <button type="button" onClick={toggleFullscreen}>{isFullscreen ? "退出全螢幕" : "全螢幕"}</button>
          <span>{Math.round(viewport.scale * 100)}%</span>
        </div>
        {expandingNodeId ? <div className="graph-expanding"><i />正在延伸圖講</div> : null}
      </div>

      {selectedNode ? (
        <div className="graph-selected">
          <div>
            <span style={{ backgroundColor: nodeColors[selectedNode.kind] }} />
            <small>{kindLabels[selectedNode.kind]} · 第 {selectedNode.depth} 層{selectedExpanded ? " · 已展開" : ""}</small>
            <h3>{selectedNode.label}</h3>
            <p>{selectedNode.summary}</p>
          </div>
          <button type="button" onClick={() => onExpand(selectedNode)} disabled={Boolean(expandingNodeId) || selectedExpanded}>
            {selectedExpanded ? "已展開" : expandingNodeId === selectedNode.id ? "延伸中" : "沿此節點展開"}
          </button>
        </div>
      ) : (
        <p className="graph-hint">點選任何節點，會繼續生成下一層知識關聯。</p>
      )}
    </section>
  );
}
