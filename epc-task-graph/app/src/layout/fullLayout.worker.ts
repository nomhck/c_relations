// 全体整列 Worker（§2.5）。4,000ノードの dagre レイアウトをメインスレッド外で実行。
import * as dagreNS from '@dagrejs/dagre';

const dagre: typeof import('@dagrejs/dagre') = (dagreNS as any).default || dagreNS;

const NODE_W = 186;
const NODE_H = 64;

interface Req {
  nodeIds: string[];
  edges: [string, string][];
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { nodeIds, edges } = e.data;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of nodeIds) g.setNode(id, { width: NODE_W, height: NODE_H });
  for (const [a, b] of edges) if (g.hasNode(a) && g.hasNode(b)) g.setEdge(a, b);
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  g.nodes().forEach((id: string) => {
    const nn = g.node(id);
    pos[id] = { x: nn.x - NODE_W / 2, y: nn.y - NODE_H / 2 };
  });
  (self as unknown as Worker).postMessage({ pos });
};
