import { describe, it, expect } from 'vitest';
import {
  buildAdjacency,
  ancestorsOf,
  canConnect,
  topoSort,
  neighborhood,
  makeTask,
  makeDep,
} from '../../src/domain';

// 小さな連鎖 A→B→C→D を作るヘルパー。
function chain(names: string[]) {
  const tasks = names.map((n) => makeTask({ name: n }));
  const deps = [];
  for (let i = 0; i + 1 < tasks.length; i++) deps.push(makeDep(tasks[i].id, tasks[i + 1].id));
  return { tasks, deps };
}

describe('graph: buildAdjacency / ancestorsOf', () => {
  it('祖先集合を BFS で正しく求める', () => {
    const { tasks, deps } = chain(['A', 'B', 'C', 'D']);
    const { pred } = buildAdjacency(deps);
    const anc = ancestorsOf(tasks[3].id, pred); // D の祖先 = {A,B,C}
    expect(anc.size).toBe(3);
    expect(anc.has(tasks[0].id)).toBe(true);
    expect(anc.has(tasks[2].id)).toBe(true);
    expect(anc.has(tasks[3].id)).toBe(false);
  });
});

describe('graph: canConnect（循環検出・§2.4）', () => {
  it('循環になる接続を拒否し経路を返す', () => {
    const { tasks, deps } = chain(['A', 'B', 'C']);
    // D→A を C→A に置き換え: A→B→C 既存、C→A は循環
    const res = canConnect(tasks[2].id, tasks[0].id, deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('cycle');
    expect(res.path).not.toBeNull();
    // 経路は A → B → C（source=C から target=A への到達経路）
    expect(res.path!.length).toBeGreaterThanOrEqual(2);
    expect(res.path![0]).toBe(tasks[0].id);
  });

  it('自己ループを拒否', () => {
    const { tasks, deps } = chain(['A', 'B']);
    const res = canConnect(tasks[0].id, tasks[0].id, deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('self');
  });

  it('重複エッジを拒否', () => {
    const { tasks, deps } = chain(['A', 'B']);
    const res = canConnect(tasks[0].id, tasks[1].id, deps); // A→B 既存
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('duplicate');
  });

  it('正当な接続を許可', () => {
    const { tasks, deps } = chain(['A', 'B', 'C']);
    const res = canConnect(tasks[0].id, tasks[2].id, deps); // A→C は循環しない
    expect(res.ok).toBe(true);
    expect(res.reason).toBeNull();
  });
});

describe('graph: topoSort（Kahn・§5.2⑤）', () => {
  it('DAG をトポロジカル順に並べる', () => {
    const { tasks, deps } = chain(['A', 'B', 'C', 'D']);
    const res = topoSort(tasks, deps);
    expect(res.ok).toBe(true);
    expect(res.hasCycle).toBe(false);
    expect(res.order.length).toBe(4);
    // A は B より前
    expect(res.order.indexOf(tasks[0].id)).toBeLessThan(res.order.indexOf(tasks[1].id));
  });

  it('循環を検出する（order.length !== tasks.length）', () => {
    const { tasks, deps } = chain(['A', 'B', 'C']);
    deps.push(makeDep(tasks[2].id, tasks[0].id)); // C→A で循環
    const res = topoSort(tasks, deps);
    expect(res.ok).toBe(false);
    expect(res.hasCycle).toBe(true);
  });
});

describe('graph: neighborhood（近傍抽出・§2.9）', () => {
  it('上流/下流 N 階層を BFS 抽出し、直接の先行/後続を返す', () => {
    const { tasks, deps } = chain(['A', 'B', 'C', 'D', 'E']); // 起点 C
    const { succ, pred } = buildAdjacency(deps);
    const nb = neighborhood(tasks[2].id, succ, pred, 1, 1);
    // 上流1(B)・下流1(D)・自身(C) = 3
    expect(nb.set.size).toBe(3);
    expect(nb.set.has(tasks[1].id)).toBe(true);
    expect(nb.set.has(tasks[3].id)).toBe(true);
    expect(nb.set.has(tasks[0].id)).toBe(false); // A は2階層先で範囲外
    expect(nb.directPred.has(tasks[1].id)).toBe(true);
    expect(nb.directSucc.has(tasks[3].id)).toBe(true);
  });

  it('深さ2で範囲が広がる', () => {
    const { tasks, deps } = chain(['A', 'B', 'C', 'D', 'E']);
    const { succ, pred } = buildAdjacency(deps);
    const nb = neighborhood(tasks[2].id, succ, pred, 2, 2);
    expect(nb.set.size).toBe(5); // 全部
  });

  it('世代マップ: 起点=0・上流=負・下流=正（§2.9 世代フィルタ）', () => {
    const { tasks, deps } = chain(['A', 'B', 'C', 'D', 'E']); // 起点 C(=index2)
    const { succ, pred } = buildAdjacency(deps);
    const nb = neighborhood(tasks[2].id, succ, pred, 2, 2);
    expect(nb.gen.get(tasks[2].id)).toBe(0); // 起点
    expect(nb.gen.get(tasks[1].id)).toBe(-1); // B 上流1世代
    expect(nb.gen.get(tasks[0].id)).toBe(-2); // A 上流2世代
    expect(nb.gen.get(tasks[3].id)).toBe(1); // D 下流1世代
    expect(nb.gen.get(tasks[4].id)).toBe(2); // E 下流2世代
  });
});
