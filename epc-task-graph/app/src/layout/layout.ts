// ============================================================================
// 自動レイアウト（§2.5）: 左→右 DAG。
// - dagreLayout: 表示中サブグラフ（数百）をメインスレッド同期で整列。
// - runFullLayout: 4,000ノード全体を Web Worker で非同期整列（UIをブロックしない）。
//   Worker 生成不可の環境ではメインスレッド fallback。
// ============================================================================
import * as dagreNS from '@dagrejs/dagre';
import type { VisibleNode, VisibleEdge } from '../domain';

const dagre: typeof import('@dagrejs/dagre') = (dagreNS as any).default || dagreNS;

const NODE_W = 186;
const NODE_H = 64;

export type PosMap = Record<string, { x: number; y: number }>;

export function dagreLayout(nodes: VisibleNode[], edges: VisibleEdge[]): PosMap {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const pos: PosMap = {};
  g.nodes().forEach((id: string) => {
    const nn = g.node(id);
    pos[id] = { x: nn.x - NODE_W / 2, y: nn.y - NODE_H / 2 };
  });
  return pos;
}

// 全体整列（Worker）。id 配列とエッジのペア配列を渡す。
export function runFullLayout(nodeIds: string[], edges: [string, string][]): Promise<PosMap> {
  return new Promise((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./fullLayout.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    if (!worker) {
      resolve(fullLayoutMainThread(nodeIds, edges));
      return;
    }
    worker.onmessage = (e: MessageEvent<{ pos: PosMap }>) => {
      resolve(e.data.pos);
      worker!.terminate();
    };
    worker.onerror = () => {
      resolve(fullLayoutMainThread(nodeIds, edges));
      worker!.terminate();
    };
    worker.postMessage({ nodeIds, edges });
  });
}

export function fullLayoutMainThread(nodeIds: string[], edges: [string, string][]): PosMap {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of nodeIds) g.setNode(id, { width: NODE_W, height: NODE_H });
  for (const [a, b] of edges) if (g.hasNode(a) && g.hasNode(b)) g.setEdge(a, b);
  dagre.layout(g);
  const pos: PosMap = {};
  g.nodes().forEach((id: string) => {
    const nn = g.node(id);
    pos[id] = { x: nn.x - NODE_W / 2, y: nn.y - NODE_H / 2 };
  });
  return pos;
}
