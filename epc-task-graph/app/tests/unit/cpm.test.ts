// ============================================================================
// CPM Step1（暦日・FS・lag無し）純関数テスト（§9.1・§10 PR4）。
// ・手計算フィクスチャ5件: ES/EF/LS/LF/TF/CP を明示検証。
// ・性能テスト: 4,000シードで <20ms（設計書 PR4 記載）。
// ============================================================================
import { describe, expect, it } from 'vitest';
import { computeCpm, addCalendarDays } from '../../src/domain/cpm';
import { deriveVisibleGraph } from '../../src/domain/deriveVisibleGraph';
import { makeTask, makeDep } from '../../src/domain/factory';
import { seedDemo } from '../../src/domain/seed';
import type { Dependency, Task } from '../../src/domain/types';

const START = '2026-01-01';

// テスト用ヘルパ: id 指定で最小タスク/依存を作る。
function T(id: string, durationDays: number, isMilestone = false): Task {
  return makeTask({ id, name: id, durationDays, isMilestone });
}
function D(pred: string, succ: string): Dependency {
  return makeDep(pred, succ, { id: `${pred}->${succ}` });
}

interface Expect {
  es: number;
  ef: number;
  ls: number;
  lf: number;
  tf: number;
  crit: boolean;
}

function checkTask(
  res: ReturnType<typeof computeCpm>,
  id: string,
  e: Expect,
) {
  const r = res.byTask.get(id);
  expect(r, `task ${id} missing`).toBeTruthy();
  expect(r!.es, `${id}.es`).toBe(e.es);
  expect(r!.ef, `${id}.ef`).toBe(e.ef);
  expect(r!.ls, `${id}.ls`).toBe(e.ls);
  expect(r!.lf, `${id}.lf`).toBe(e.lf);
  expect(r!.totalFloat, `${id}.tf`).toBe(e.tf);
  expect(r!.isCritical, `${id}.crit`).toBe(e.crit);
}

describe('CPM Step1 手計算フィクスチャ', () => {
  // ── フィクスチャ1: 単純チェーン A(3)→B(2)→C(4)。全タスク TF=0 でクリティカル ──
  it('fixture1: 直列チェーン（全クリティカル）', () => {
    const tasks = [T('A', 3), T('B', 2), T('C', 4)];
    const deps = [D('A', 'B'), D('B', 'C')];
    const res = computeCpm(tasks, deps, START);
    checkTask(res, 'A', { es: 0, ef: 3, ls: 0, lf: 3, tf: 0, crit: true });
    checkTask(res, 'B', { es: 3, ef: 5, ls: 3, lf: 5, tf: 0, crit: true });
    checkTask(res, 'C', { es: 5, ef: 9, ls: 5, lf: 9, tf: 0, crit: true });
    expect(res.projectEnd).toBe(9);
    expect(res.projectEndDate).toBe(addCalendarDays(START, 9));
    expect([...res.criticalEdges].sort()).toEqual(['A->B', 'B->C']);
  });

  // ── フィクスチャ2: ダイヤ A(2)→B(4)→D(1), A→C(2)→D。C 枝に TF=2 の余裕 ──
  it('fixture2: ダイヤ（C枝に余裕）', () => {
    const tasks = [T('A', 2), T('B', 4), T('C', 2), T('D', 1)];
    const deps = [D('A', 'B'), D('B', 'D'), D('A', 'C'), D('C', 'D')];
    const res = computeCpm(tasks, deps, START);
    checkTask(res, 'A', { es: 0, ef: 2, ls: 0, lf: 2, tf: 0, crit: true });
    checkTask(res, 'B', { es: 2, ef: 6, ls: 2, lf: 6, tf: 0, crit: true });
    checkTask(res, 'C', { es: 2, ef: 4, ls: 4, lf: 6, tf: 2, crit: false });
    checkTask(res, 'D', { es: 6, ef: 7, ls: 6, lf: 7, tf: 0, crit: true });
    expect(res.projectEnd).toBe(7);
    expect([...res.criticalEdges].sort()).toEqual(['A->B', 'B->D']);
  });

  // ── フィクスチャ3: 合流 A(5)→C, B(2)→C(3)。B 枝に TF=3 の余裕。ES=max(先行) ──
  it('fixture3: 合流（先行の max を取る）', () => {
    const tasks = [T('A', 5), T('B', 2), T('C', 3)];
    const deps = [D('A', 'C'), D('B', 'C')];
    const res = computeCpm(tasks, deps, START);
    checkTask(res, 'A', { es: 0, ef: 5, ls: 0, lf: 5, tf: 0, crit: true });
    checkTask(res, 'B', { es: 0, ef: 2, ls: 3, lf: 5, tf: 3, crit: false });
    checkTask(res, 'C', { es: 5, ef: 8, ls: 5, lf: 8, tf: 0, crit: true });
    expect(res.projectEnd).toBe(8);
    expect([...res.criticalEdges].sort()).toEqual(['A->C']);
  });

  // ── フィクスチャ4: マイルストーン A(4)→M(0)→B(3)。M は duration=0、全クリティカル ──
  it('fixture4: マイルストーン（duration=0）', () => {
    const tasks = [T('A', 4), T('M', 0, true), T('B', 3)];
    const deps = [D('A', 'M'), D('M', 'B')];
    const res = computeCpm(tasks, deps, START);
    checkTask(res, 'A', { es: 0, ef: 4, ls: 0, lf: 4, tf: 0, crit: true });
    checkTask(res, 'M', { es: 4, ef: 4, ls: 4, lf: 4, tf: 0, crit: true });
    checkTask(res, 'B', { es: 4, ef: 7, ls: 4, lf: 7, tf: 0, crit: true });
    expect(res.projectEnd).toBe(7);
    expect([...res.criticalEdges].sort()).toEqual(['A->M', 'M->B']);
  });

  // ── フィクスチャ5: 複数シンク A(3)→B(5)[sink], A→C(2)→D(1)[sink]。projectEnd=max ──
  it('fixture5: 複数シンク（projectEnd = 全EFのmax）', () => {
    const tasks = [T('A', 3), T('B', 5), T('C', 2), T('D', 1)];
    const deps = [D('A', 'B'), D('A', 'C'), D('C', 'D')];
    const res = computeCpm(tasks, deps, START);
    checkTask(res, 'A', { es: 0, ef: 3, ls: 0, lf: 3, tf: 0, crit: true });
    checkTask(res, 'B', { es: 3, ef: 8, ls: 3, lf: 8, tf: 0, crit: true });
    checkTask(res, 'C', { es: 3, ef: 5, ls: 5, lf: 7, tf: 2, crit: false });
    checkTask(res, 'D', { es: 5, ef: 6, ls: 7, lf: 8, tf: 2, crit: false });
    expect(res.projectEnd).toBe(8); // B の EF=8 が全体を決める
    expect([...res.criticalEdges].sort()).toEqual(['A->B']);
  });
});

describe('CPM 依存タイプ＋lag（Phase 2 手計算フィクスチャ）', () => {
  const Dt = (pred: string, succ: string, type: Dependency['type'], lag = 0): Dependency =>
    makeDep(pred, succ, { id: `${pred}->${succ}`, type, lagDays: lag });

  it('SS+lag2: 後続は先行のES+2で始まる（A dur4 →SS2→ B dur3）', () => {
    const res = computeCpm([T('A', 4), T('B', 3)], [Dt('A', 'B', 'SS', 2)], START);
    checkTask(res, 'A', { es: 0, ef: 4, ls: 0, lf: 4, tf: 0, crit: true });
    checkTask(res, 'B', { es: 2, ef: 5, ls: 2, lf: 5, tf: 0, crit: true });
    expect(res.projectEnd).toBe(5);
    expect([...res.criticalEdges]).toEqual(['A->B']);
  });

  it('FF+lag1: 後続は先行のEF+1で終わる（A dur4 →FF1→ B dur2）', () => {
    const res = computeCpm([T('A', 4), T('B', 2)], [Dt('A', 'B', 'FF', 1)], START);
    checkTask(res, 'A', { es: 0, ef: 4, ls: 0, lf: 4, tf: 0, crit: true });
    checkTask(res, 'B', { es: 3, ef: 5, ls: 3, lf: 5, tf: 0, crit: true }); // EF_B=EF_A+1=5 → ES=3
    expect(res.projectEnd).toBe(5);
  });

  it('SF+lag5: 後続の終了は先行の開始+5以降（A dur3 →SF5→ B dur2）', () => {
    const res = computeCpm([T('A', 3), T('B', 2)], [Dt('A', 'B', 'SF', 5)], START);
    checkTask(res, 'A', { es: 0, ef: 3, ls: 0, lf: 3, tf: 0, crit: true });
    checkTask(res, 'B', { es: 3, ef: 5, ls: 3, lf: 5, tf: 0, crit: true }); // EF_B≥ES_A+5=5
    expect(res.projectEnd).toBe(5);
  });

  it('FS+リード(-2): 後続は先行終了の2日前から開始できる（A dur5 →FS(-2)→ B dur3）', () => {
    const res = computeCpm([T('A', 5), T('B', 3)], [Dt('A', 'B', 'FS', -2)], START);
    checkTask(res, 'A', { es: 0, ef: 5, ls: 0, lf: 5, tf: 0, crit: true });
    checkTask(res, 'B', { es: 3, ef: 6, ls: 3, lf: 6, tf: 0, crit: true }); // ES_B=EF_A-2=3
    expect(res.projectEnd).toBe(6);
    expect(res.byTask.get('B')!.esDate).toBe(addCalendarDays(START, 3));
  });
});

describe('CPM × 表示パイプライン統合（§9.2「CPのみ表示」/ CP強調）', () => {
  // ダイヤ（fixture2）: 背骨 A→B→D。C は余裕ありで CP から外れる。
  const tasks = [T('A', 2), T('B', 4), T('C', 2), T('D', 1)];
  const deps = [D('A', 'B'), D('B', 'D'), D('A', 'C'), D('C', 'D')];
  const cpm = computeCpm(tasks, deps, START);

  it('criticalOnly + ISOLATE で背骨チェーン（A,B,D）だけが抽出される', () => {
    const res = deriveVisibleGraph(tasks, deps, {
      filter: { criticalOnly: true },
      displayMode: 'ISOLATE',
      collapsedWbs: [],
      focus: null,
      me: '',
      criticalTasks: cpm.criticalTasks,
      criticalEdges: cpm.criticalEdges,
      cpHighlight: true,
    });
    const ids = res.visibleNodes.map((n) => n.id).sort();
    expect(ids).toEqual(['A', 'B', 'D']);
    // 抽出された全ノードが critical フラグ（CP強調）付き。
    expect(res.visibleNodes.every((n) => n.kind === 'task' && n.critical)).toBe(true);
    // 駆動依存（A->B, B->D）のエッジが critical 強調される。
    const critEdges = res.visibleEdges.filter((e) => e.critical).map((e) => e.realId).sort();
    expect(critEdges).toEqual(['A->B', 'B->D']);
  });

  it('cpHighlight=false のときは critical 視覚フラグが立たない', () => {
    const res = deriveVisibleGraph(tasks, deps, {
      filter: {},
      displayMode: 'DIM',
      collapsedWbs: [],
      focus: null,
      me: '',
      criticalTasks: cpm.criticalTasks,
      criticalEdges: cpm.criticalEdges,
      cpHighlight: false,
    });
    expect(res.visibleNodes.some((n) => n.kind === 'task' && n.critical)).toBe(false);
    expect(res.visibleEdges.some((e) => e.critical)).toBe(false);
  });
});

describe('CPM 性能（§10 PR4: 4,000シードで <20ms）', () => {
  it('4,000タスクで <20ms（中央値）', () => {
    const doc = seedDemo({ count: 4000, density: 1.5 });
    // ウォームアップ（JIT）
    computeCpm(doc.tasks, doc.dependencies, doc.project.dataDate);
    const samples: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const res = computeCpm(doc.tasks, doc.dependencies, doc.project.dataDate);
      samples.push(performance.now() - t0);
      expect(res.byTask.size).toBe(doc.tasks.length);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    // 実測値をログ（受入報告用）
    // eslint-disable-next-line no-console
    console.log(`[CPM perf] tasks=${doc.tasks.length} deps=${doc.dependencies.length} median=${median.toFixed(2)}ms min=${samples[0].toFixed(2)}ms`);
    expect(median).toBeLessThan(20);
  });
});
