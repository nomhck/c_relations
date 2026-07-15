// ============================================================================
// グラフ演算（§2.4 循環防止 / §2.9 近傍 / §5.2 DAG検証）。UI非依存の純関数。
// 隣接リストは O(V+E)。4,000ノード・6,000エッジで頭打ちしない（§2.4 計算量）。
// ============================================================================
import type {
  Adjacency,
  ConnectResult,
  Dependency,
  Neighborhood,
  Task,
  TopoResult,
} from './types';

export function buildAdjacency(deps: Dependency[]): Adjacency {
  const succ = new Map<string, Set<string>>();
  const pred = new Map<string, Set<string>>();
  for (const d of deps) {
    if (!succ.has(d.predecessorId)) succ.set(d.predecessorId, new Set());
    if (!pred.has(d.successorId)) pred.set(d.successorId, new Set());
    succ.get(d.predecessorId)!.add(d.successorId);
    pred.get(d.successorId)!.add(d.predecessorId);
  }
  return { succ, pred };
}

// source の祖先集合（BFS）。ドラッグ開始時に1回計算し、判定は O(1)（§2.4）。
export function ancestorsOf(sourceId: string, pred: Map<string, Set<string>>): Set<string> {
  const anc = new Set<string>();
  const q: string[] = [sourceId];
  while (q.length) {
    const cur = q.pop()!;
    const ps = pred.get(cur);
    if (!ps) continue;
    for (const p of ps)
      if (!anc.has(p)) {
        anc.add(p);
        q.push(p);
      }
  }
  return anc;
}

// 循環になる接続の「なぜダメか」を教える経路 A → … → B を求める（§2.4）。
export function findCyclePath(
  sourceId: string,
  targetId: string,
  succ: Map<string, Set<string>>,
): string[] | null {
  const prevOf = new Map<string, string>();
  const q: string[] = [targetId];
  const seen = new Set<string>([targetId]);
  while (q.length) {
    const cur = q.shift()!;
    if (cur === sourceId) {
      const path: string[] = [];
      let c: string | undefined = sourceId;
      while (c !== undefined) {
        path.push(c);
        c = prevOf.get(c);
      }
      return path.reverse();
    }
    const ss = succ.get(cur);
    if (!ss) continue;
    for (const s of ss)
      if (!seen.has(s)) {
        seen.add(s);
        prevOf.set(s, cur);
        q.push(s);
      }
  }
  return null;
}

// 接続可否（自己ループ・重複・循環を拒否）。§2.4 の UI 予防と同一ロジック。
export function canConnect(
  sourceId: string,
  targetId: string,
  deps: Dependency[],
): ConnectResult {
  if (sourceId === targetId) return { ok: false, reason: 'self', path: null };
  for (const d of deps) {
    if (d.predecessorId === sourceId && d.successorId === targetId)
      return { ok: false, reason: 'duplicate', path: null };
  }
  const { succ, pred } = buildAdjacency(deps);
  const anc = ancestorsOf(sourceId, pred);
  if (anc.has(targetId))
    return { ok: false, reason: 'cycle', path: findCyclePath(sourceId, targetId, succ) };
  return { ok: true, reason: null, path: null };
}

// Kahn のトポロジカルソート。order.length !== tasks.length なら循環あり（§5.2 検証⑤）。
export function topoSort(tasks: Task[], deps: Dependency[]): TopoResult {
  const indeg = new Map<string, number>();
  for (const t of tasks) indeg.set(t.id, 0);
  const { succ } = buildAdjacency(deps);
  for (const d of deps)
    if (indeg.has(d.successorId)) indeg.set(d.successorId, indeg.get(d.successorId)! + 1);
  const q: string[] = [];
  for (const [id, dg] of indeg) if (dg === 0) q.push(id);
  const order: string[] = [];
  while (q.length) {
    const cur = q.shift()!;
    order.push(cur);
    const ss = succ.get(cur);
    if (!ss) continue;
    for (const s of ss) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) q.push(s);
    }
  }
  const ok = order.length === tasks.length;
  return { ok, order, hasCycle: !ok };
}

// 近傍抽出（§2.9）: 起点から上流 up 階層・下流 down 階層を BFS。直接の先行/後続も返す。
export function neighborhood(
  originId: string,
  succ: Map<string, Set<string>>,
  pred: Map<string, Set<string>>,
  up: number,
  down: number,
): Neighborhood {
  const set = new Set<string>([originId]);
  const directPred = new Set<string>();
  const directSucc = new Set<string>();
  let frontier: string[] = [originId];
  for (let lvl = 0; lvl < up; lvl++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const ps = pred.get(cur);
      if (!ps) continue;
      for (const p of ps) {
        if (lvl === 0) directPred.add(p);
        if (!set.has(p)) {
          set.add(p);
          next.push(p);
        }
      }
    }
    frontier = next;
  }
  frontier = [originId];
  for (let lvl = 0; lvl < down; lvl++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const ss = succ.get(cur);
      if (!ss) continue;
      for (const s of ss) {
        if (lvl === 0) directSucc.add(s);
        if (!set.has(s)) {
          set.add(s);
          next.push(s);
        }
      }
    }
    frontier = next;
  }
  return { set, directPred, directSucc };
}
