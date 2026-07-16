// ============================================================================
// CPM（クリティカルパス法）Step1 — §9.1。UI/React/DOM 非依存の純関数。
// スコープ（Step1）: 暦日ベース・依存は FS のみ・lag 無し（SS/FF/SF・カレンダー・
//   SNET/FNLT 制約は Phase 2 で追加）。所要日数は task.durationDays、開始基準日は
//   プロジェクト設定（dataDate）。
// 内部は「projectStart からの暦日オフセット（number）」で計算し、表示用に実日付へ変換。
// 性能: O(V+E)、4,000ノード・6,000エッジで <20ms（§9.1）。メインスレッド同期でよい。
// ============================================================================
import type { Dependency, Task } from './types';
import { buildAdjacency } from './graph';

export interface CpmTaskResult {
  es: number; // Early Start（暦日オフセット）
  ef: number; // Early Finish
  ls: number; // Late Start
  lf: number; // Late Finish
  totalFloat: number; // LS − ES（= LF − EF）
  isCritical: boolean; // TF ≤ 0
  esDate: string; // ES の実日付（yyyy-mm-dd）
  efDate: string;
  lsDate: string;
  lfDate: string;
}

export interface CpmResult {
  byTask: Map<string, CpmTaskResult>;
  criticalTasks: Set<string>; // isCritical=true の集合（フィルタ/強調で共有・§5.1）
  criticalEdges: Set<string>; // 駆動依存（クリティカルなエッジ）の dependency.id 集合
  projectStart: number; // 常に 0
  projectEnd: number; // max(全EF)
  projectStartDate: string; // = dataDate
  projectEndDate: string;
}

// yyyy-mm-dd に n 日加算（暦日。UTC 固定でオフバイワン回避）。
export function addCalendarDays(isoDate: string, n: number): string {
  const base = parseISODate(isoDate);
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
}

function parseISODate(iso: string): number {
  // "2026-07-09" or ISO datetime → UTC 深夜のミリ秒。
  const s = (iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.UTC(2000, 0, 1) : t;
}

const EMPTY: Omit<CpmResult, 'projectStartDate' | 'projectEndDate'> & {
  projectStartDate: string;
  projectEndDate: string;
} = {
  byTask: new Map(),
  criticalTasks: new Set(),
  criticalEdges: new Set(),
  projectStart: 0,
  projectEnd: 0,
  projectStartDate: '',
  projectEndDate: '',
};

/**
 * CPM Step1（暦日・FS・lag無し）を計算する。
 * @param tasks       タスク配列（durationDays を使用。milestone は 0）
 * @param deps        依存配列（type は FS 前提で処理。他タイプは Step1 では FS 同等に扱う）
 * @param projectStart 開始基準日（yyyy-mm-dd。通常 project.dataDate）
 */
export function computeCpm(
  tasks: Task[],
  deps: Dependency[],
  projectStart: string,
): CpmResult {
  if (tasks.length === 0) {
    return { ...EMPTY, byTask: new Map(), criticalTasks: new Set(), criticalEdges: new Set(), projectStartDate: (projectStart || '').slice(0, 10), projectEndDate: (projectStart || '').slice(0, 10) };
  }

  const taskById = new Map<string, Task>();
  for (const t of tasks) taskById.set(t.id, t);
  const { succ, pred } = buildAdjacency(deps);

  // ---- トポロジカルソート（Kahn）。循環は UI 上起き得ないが防御（§9.1-1）----
  const indeg = new Map<string, number>();
  for (const t of tasks) indeg.set(t.id, 0);
  for (const d of deps) if (indeg.has(d.successorId)) indeg.set(d.successorId, indeg.get(d.successorId)! + 1);
  const queue: string[] = [];
  for (const [id, dg] of indeg) if (dg === 0) queue.push(id);
  const order: string[] = [];
  const idegWork = new Map(indeg);
  const qq = [...queue];
  while (qq.length) {
    const cur = qq.shift()!;
    order.push(cur);
    for (const s of succ.get(cur) || []) {
      idegWork.set(s, idegWork.get(s)! - 1);
      if (idegWork.get(s) === 0) qq.push(s);
    }
  }
  // 循環があれば残りを末尾に足して部分計算だけ返す（クラッシュ回避）。
  if (order.length !== tasks.length) {
    for (const t of tasks) if (!order.includes(t.id)) order.push(t.id);
  }

  const dur = (id: string): number => {
    const t = taskById.get(id);
    if (!t) return 0;
    return t.isMilestone ? 0 : Math.max(0, t.durationDays || 0);
  };

  // ---- 前進計算（トポ順）: ES = max(先行の EF)、EF = ES + dur（§9.1-2, FS）----
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    let start = 0;
    const ps = pred.get(id);
    if (ps) for (const p of ps) start = Math.max(start, ef.get(p) ?? 0);
    es.set(id, start);
    ef.set(id, start + dur(id));
  }

  const projectEnd = Math.max(0, ...order.map((id) => ef.get(id) ?? 0));

  // ---- 後退計算（逆トポ順）: LF = min(後続の LS)、後続なしは projectEnd（§9.1-3）----
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    let finish = projectEnd;
    const ss = succ.get(id);
    if (ss && ss.size) {
      finish = Infinity;
      for (const s of ss) finish = Math.min(finish, ls.get(s) ?? projectEnd);
    }
    lf.set(id, finish);
    ls.set(id, finish - dur(id));
  }

  // ---- TF = LS − ES、TF ≤ 0 がクリティカル（§9.1-4）----
  const byTask = new Map<string, CpmTaskResult>();
  const criticalTasks = new Set<string>();
  const startDate = (projectStart || '').slice(0, 10) || '2026-01-01';
  for (const t of tasks) {
    const id = t.id;
    const _es = es.get(id) ?? 0;
    const _ef = ef.get(id) ?? 0;
    const _ls = ls.get(id) ?? 0;
    const _lf = lf.get(id) ?? 0;
    const tf = Math.round((_ls - _es) * 1000) / 1000;
    const crit = tf <= 0;
    if (crit) criticalTasks.add(id);
    byTask.set(id, {
      es: _es,
      ef: _ef,
      ls: _ls,
      lf: _lf,
      totalFloat: tf,
      isCritical: crit,
      esDate: addCalendarDays(startDate, _es),
      efDate: addCalendarDays(startDate, _ef),
      lsDate: addCalendarDays(startDate, _ls),
      lfDate: addCalendarDays(startDate, _lf),
    });
  }

  // ---- 駆動依存（クリティカルなエッジ）: 両端がクリティカルで pred.EF == succ.ES（FS）----
  const criticalEdges = new Set<string>();
  for (const d of deps) {
    if (!criticalTasks.has(d.predecessorId) || !criticalTasks.has(d.successorId)) continue;
    const pEf = ef.get(d.predecessorId);
    const sEs = es.get(d.successorId);
    if (pEf != null && sEs != null && Math.abs(pEf - sEs) < 1e-9) criticalEdges.add(d.id);
  }

  return {
    byTask,
    criticalTasks,
    criticalEdges,
    projectStart: 0,
    projectEnd,
    projectStartDate: startDate,
    projectEndDate: addCalendarDays(startDate, projectEnd),
  };
}
