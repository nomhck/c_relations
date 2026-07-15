import { describe, it, expect } from 'vitest';
import {
  seedDemo,
  deriveVisibleGraph,
  graphDocSchema,
  validateDoc,
  type ViewSpec,
} from '../../src/domain';

function spec(p: Partial<ViewSpec> = {}): ViewSpec {
  return { filter: {}, displayMode: 'DIM', collapsedWbs: [], focus: null, me: '', ...p };
}

describe('seed: 4,000ノードシード（§10 共通ルール）', () => {
  const doc = seedDemo({ count: 4000, density: 1.5 });

  it('4,000タスク・密度1.5相当の依存を生成する', () => {
    expect(doc.tasks.length).toBe(4000);
    // density 1.5 → 約 6,000 エッジ。連鎖＋ランダムで targetEdges 近辺。
    expect(doc.dependencies.length).toBeGreaterThan(4000);
    expect(doc.dependencies.length).toBeLessThanOrEqual(6100);
  });

  it('生成物が Zod スキーマ（§5.2）に準拠する', () => {
    const parsed = graphDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });

  it('生成物が意味的検証（ID一意・参照整合・DAG）に合格する', () => {
    const res = validateDoc(doc);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('決定的（同一seedで同一タスク数・同一名の先頭）', () => {
    const a = seedDemo({ count: 100, seed: 42 });
    const b = seedDemo({ count: 100, seed: 42 });
    expect(a.tasks.map((t) => t.name)).toEqual(b.tasks.map((t) => t.name));
  });

  it('assignee は部署名（班/セクション単位・§7.5確定事項）', () => {
    const uniqueAssignees = new Set(doc.tasks.map((t) => t.assignee));
    expect(uniqueAssignees.size).toBe(10);
    // 個人名ではなく「課」単位
    expect([...uniqueAssignees].every((a) => a.endsWith('課'))).toBe(true);
  });
});

describe('seed: deriveVisibleGraph 性能（§0.4 4,000ノードで<数十ms）', () => {
  const doc = seedDemo({ count: 4000, density: 1.5 });

  it('既定レベル2展開の導出が高速（<50ms）', () => {
    const view = spec({ collapsedWbs: doc.viewState.collapsedWbs });
    // ウォームアップ
    deriveVisibleGraph(doc.tasks, doc.dependencies, view);
    const t0 = performance.now();
    const res = deriveVisibleGraph(doc.tasks, doc.dependencies, view);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(50);
    // レベル2集約で表示ノードは数百以下に制御される（性能戦略、§2.6）
    expect(res.stats.visible).toBeLessThan(300);
  });

  it('ISOLATE フィルタ（担当1部署）で可視数が数十〜数百に減る（§10 受入(e)）', () => {
    const dept = doc.tasks[0].assignee;
    const res = deriveVisibleGraph(
      doc.tasks,
      doc.dependencies,
      spec({ filter: { assignees: [dept] }, displayMode: 'ISOLATE' }),
    );
    // 10部署に均等配分 → 1部署あたり約400。数十〜数百のレンジに入る。
    expect(res.stats.visible).toBeGreaterThan(30);
    expect(res.stats.visible).toBeLessThan(600);
    // 全4,000から確実に大幅減
    expect(res.stats.visible).toBeLessThan(doc.tasks.length / 2);
  });

  it('複合フィルタ（担当＋工種＋WBS）で数十まで絞れる', () => {
    const dept = doc.tasks[0].assignee;
    const res = deriveVisibleGraph(
      doc.tasks,
      doc.dependencies,
      spec({
        filter: { assignees: [dept], disciplines: ['E'], wbsPrefixes: ['1.1'] },
        displayMode: 'ISOLATE',
      }),
    );
    expect(res.stats.visible).toBeLessThan(100);
  });
});
