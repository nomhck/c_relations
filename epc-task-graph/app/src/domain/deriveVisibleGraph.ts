// ============================================================================
// 表示パイプライン（§2.6）: フィルタ判定 → WBS折り畳み → 近傍フォーカス を1本に統合。
// 「4,000を一度に描かない」性能戦略そのもの。全段 O(V+E)。UI/React Flow 非依存の純関数。
// ============================================================================
import type {
  DeriveResult,
  Dependency,
  DisciplineBreakdown,
  Task,
  VisibleEdge,
  VisibleNode,
  ViewSpec,
} from './types';
import { buildAdjacency, expandBoundary, neighborhood } from './graph';
import { isFilterActive, matchesFilter } from './filter';
import { isWbsPrefix } from './wbs';

interface Candidate {
  task: Task;
  dim: boolean;
  outside: boolean;
  isOrigin?: boolean;
  directPred?: boolean;
  directSucc?: boolean;
  related?: boolean;
  gen?: number;
}

export function deriveVisibleGraph(
  tasks: Task[],
  deps: Dependency[],
  viewSpec: Partial<ViewSpec> | null | undefined,
): DeriveResult {
  const filter = (viewSpec && viewSpec.filter) || {};
  const displayMode = (viewSpec && viewSpec.displayMode) || 'DIM';
  const collapsedWbs = (viewSpec && viewSpec.collapsedWbs) || [];
  const focus = (viewSpec && viewSpec.focus) || null;
  const boundaryUp = (viewSpec && viewSpec.boundaryUp) || 0;
  const boundaryDown = (viewSpec && viewSpec.boundaryDown) || 0;
  const me = (viewSpec && viewSpec.me) || '';
  const criticalTasks = (viewSpec && viewSpec.criticalTasks) || null;
  const criticalEdges = (viewSpec && viewSpec.criticalEdges) || null;
  // CP強調は「トグル ON」かつ「criticalTasks が渡っている」時のみ視覚フラグを立てる。
  const cpHighlight = !!(viewSpec && viewSpec.cpHighlight) && !!criticalTasks;

  const taskById = new Map<string, Task>();
  for (const t of tasks) taskById.set(t.id, t);
  const { succ, pred } = buildAdjacency(deps);

  const active = isFilterActive(filter);
  const matchSet = new Set<string>();
  if (active) for (const t of tasks) if (matchesFilter(t, filter, me, criticalTasks)) matchSet.add(t.id);

  let nb: ReturnType<typeof neighborhood> | null = null;
  if (focus && focus.taskId && taskById.has(focus.taskId)) {
    nb = neighborhood(focus.taskId, succ, pred, focus.up != null ? focus.up : 2, focus.down != null ? focus.down : 2);
  }
  // 'highlight'=近傍を強調しつつ全体を残す（非近傍は淡色）。'isolate'（既定）=近傍だけ抽出。
  const nbHighlight = !!(nb && focus!.mode === 'highlight');
  const isoRemove = active && displayMode === 'ISOLATE' && !nb;

  // 「担当＋前後」ビュー: フィルタ一致集合から前後の受け渡し先を文脈として含める（§2.9拡張）。
  // focus 中は無効（focus 優先）。boundary タスクは outside=文脈扱いで表示。
  const boundarySet =
    active && !nb && (boundaryUp > 0 || boundaryDown > 0)
      ? expandBoundary(matchSet, succ, pred, boundaryUp, boundaryDown)
      : null;

  const cands: Candidate[] = [];
  for (const t of tasks) {
    if (nb && nbHighlight) {
      // 関係ハイライト: 全タスクを残し、近傍を related+世代タグ・非近傍を淡色（dim）。
      const inNb = nb.set.has(t.id);
      cands.push({
        task: t,
        dim: !inNb,
        outside: false,
        isOrigin: t.id === focus!.taskId,
        directPred: nb.directPred.has(t.id),
        directSucc: nb.directSucc.has(t.id),
        related: inNb,
        gen: inNb ? nb.gen.get(t.id) : undefined,
      });
    } else if (nb) {
      if (!nb.set.has(t.id)) continue;
      cands.push({
        task: t,
        dim: false,
        outside: active && !matchSet.has(t.id),
        isOrigin: t.id === focus!.taskId,
        directPred: nb.directPred.has(t.id),
        directSucc: nb.directSucc.has(t.id),
        related: true,
        gen: nb.gen.get(t.id),
      });
    } else if (isoRemove) {
      // ISOLATE: 一致タスク＋（あれば）前後の受け渡し先だけ残す。受け渡し先は outside=文脈。
      const isMatch = matchSet.has(t.id);
      const isBoundary = !!boundarySet && boundarySet.has(t.id);
      if (!isMatch && !isBoundary) continue;
      cands.push({ task: t, dim: false, outside: !isMatch });
    } else {
      // DIM: 一致＝通常／受け渡し先＝outside 文脈／それ以外＝淡色。
      const isMatch = !active || matchSet.has(t.id);
      const isBoundary = !!boundarySet && boundarySet.has(t.id);
      cands.push({
        task: t,
        dim: active && displayMode === 'DIM' && !isMatch && !isBoundary,
        outside: active && !isMatch && isBoundary,
      });
    }
  }
  const candIds = new Set(cands.map((c) => c.task.id));

  let effCollapsed: string[] = collapsedWbs;
  if (isoRemove) effCollapsed = [];
  // フォーカス中は近傍タスクを含む WBS 枝だけ自動展開（近傍を実タスクとして見せる、§2.9）。
  // highlight では cands に全タスクが入るため、展開判定は必ず nb.set（実際の近傍）で行う——
  // さもないと非近傍の枝まで展開され集約が消えて全ノード描画になる。
  if (nb) {
    const nbTasks = tasks.filter((t) => nb!.set.has(t.id));
    effCollapsed = collapsedWbs.filter((p) => !nbTasks.some((t) => isWbsPrefix(p, t.wbsCode)));
  }
  const collapsedSorted = [...new Set(effCollapsed)].filter(Boolean).sort((a, b) => a.length - b.length);
  const repOf = (task: Task): string => {
    for (const p of collapsedSorted) if (isWbsPrefix(p, task.wbsCode)) return 'wbs::' + p;
    return task.id;
  };

  const nodeMap = new Map<string, VisibleNode>();
  const aggMembers = new Map<string, Candidate[]>();
  for (const c of cands) {
    const rep = repOf(c.task);
    if (rep.startsWith('wbs::')) {
      if (!aggMembers.has(rep)) aggMembers.set(rep, []);
      aggMembers.get(rep)!.push(c);
    } else {
      nodeMap.set(rep, {
        kind: 'task',
        id: c.task.id,
        task: c.task,
        position: c.task.position,
        dim: c.dim,
        outside: c.outside,
        isOrigin: !!c.isOrigin,
        directPred: !!c.directPred,
        directSucc: !!c.directSucc,
        critical: cpHighlight && criticalTasks!.has(c.task.id),
        related: c.related,
        gen: c.gen,
      });
    }
  }
  for (const [aggId, members] of aggMembers) {
    const prefix = aggId.slice(5);
    let sx = 0,
      sy = 0,
      sp = 0,
      hasMs = false,
      hasCrit = false;
    const disc: DisciplineBreakdown = { E: 0, P: 0, C: 0, OTHER: 0 };
    for (const m of members) {
      sx += m.task.position.x;
      sy += m.task.position.y;
      sp += m.task.progress;
      disc[m.task.discipline] = (disc[m.task.discipline] || 0) + 1;
      if (m.task.isMilestone) hasMs = true;
      if (criticalTasks && criticalTasks.has(m.task.id)) hasCrit = true;
    }
    const n = members.length;
    nodeMap.set(aggId, {
      kind: 'aggregate',
      id: aggId,
      prefix,
      memberIds: members.map((m) => m.task.id),
      position: { x: sx / n, y: sy / n },
      count: n,
      disc,
      avgProgress: Math.round(sp / n),
      hasMilestone: hasMs,
      hasCritical: hasCrit,
      dim: members.every((m) => m.dim),
    });
  }

  const edgeMap = new Map<string, VisibleEdge>();
  for (const d of deps) {
    if (!candIds.has(d.predecessorId) || !candIds.has(d.successorId)) continue;
    const a = repOf(taskById.get(d.predecessorId)!);
    const b = repOf(taskById.get(d.successorId)!);
    if (a === b) continue;
    if (!nodeMap.has(a) || !nodeMap.has(b)) continue;
    const key = a + '->' + b;
    const isAgg = a.startsWith('wbs::') || b.startsWith('wbs::');
    let e = edgeMap.get(key);
    if (!e) {
      e = { id: 'e::' + key, source: a, target: b, aggregate: isAgg, count: 0, highlight: false, critical: false, realId: d.id };
      edgeMap.set(key, e);
    }
    e.count++;
    if (nb && (d.predecessorId === focus!.taskId || d.successorId === focus!.taskId)) e.highlight = true;
    if (cpHighlight && criticalEdges && criticalEdges.has(d.id)) e.critical = true;
  }

  // フォーカスの continuation 集約（§2.9「折り畳み先への継続がバッジで見える」）。
  if (nb) {
    const level2 = (code: string): string => {
      const seg = (code || '').split('.').filter(Boolean);
      return seg.length >= 2 ? seg.slice(0, 2).join('.') : code || '（ルート）';
    };
    const repOfId = (id: string): string => {
      const t = taskById.get(id);
      return t ? repOf(t) : id;
    };
    interface ContGroup {
      prefix: string;
      tasks: Set<string>;
      out: Set<string>;
      in: Set<string>;
      sx: number;
      sy: number;
    }
    const groups = new Map<string, ContGroup>();
    for (const c of cands) {
      const id = c.task.id;
      const repA = repOfId(id);
      if (!nodeMap.has(repA)) continue;
      const addCont = (otherId: string, isSucc: boolean) => {
        if (nb!.set.has(otherId)) return;
        const ot = taskById.get(otherId);
        if (!ot) return;
        const key = 'cont::' + level2(ot.wbsCode);
        if (!groups.has(key))
          groups.set(key, { prefix: level2(ot.wbsCode), tasks: new Set(), out: new Set(), in: new Set(), sx: 0, sy: 0 });
        const g = groups.get(key)!;
        if (!g.tasks.has(otherId)) {
          g.tasks.add(otherId);
          g.sx += ot.position.x;
          g.sy += ot.position.y;
        }
        if (isSucc) g.out.add(repA);
        else g.in.add(repA);
      };
      for (const s of succ.get(id) || []) addCont(s, true);
      for (const p of pred.get(id) || []) addCont(p, false);
    }
    for (const [key, g] of groups) {
      const n = g.tasks.size;
      nodeMap.set(key, {
        kind: 'aggregate',
        id: key,
        prefix: g.prefix,
        continuation: true,
        memberIds: [...g.tasks],
        position: { x: g.sx / n, y: g.sy / n },
        count: n,
        disc: { E: 0, P: 0, C: 0, OTHER: 0 },
        avgProgress: 0,
        hasMilestone: false,
        hasCritical: false,
        dim: false,
      });
      for (const rep of g.out)
        edgeMap.set(rep + '->' + key, {
          id: 'e::' + rep + '->' + key,
          source: rep,
          target: key,
          aggregate: true,
          continuation: true,
          count: n,
          highlight: false,
          critical: false,
        });
      for (const rep of g.in)
        edgeMap.set(key + '->' + rep, {
          id: 'e::' + key + '->' + rep,
          source: key,
          target: rep,
          aggregate: true,
          continuation: true,
          count: n,
          highlight: false,
          critical: false,
        });
    }
  }

  const visibleNodes = [...nodeMap.values()];
  const visibleEdges = [...edgeMap.values()];
  return {
    visibleNodes,
    visibleEdges,
    stats: {
      total: tasks.length,
      visible: visibleNodes.length,
      aggregates: aggMembers.size,
      matched: active ? matchSet.size : tasks.length,
      edges: visibleEdges.length,
    },
  };
}
