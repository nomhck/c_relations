import { describe, it, expect } from 'vitest';
import { validateDoc, emptyDoc, makeTask, makeDep, starterDoc } from '../../src/domain';

describe('validate: §5.2 バリデーション①〜⑦', () => {
  it('空ドキュメント/スターターは合格', () => {
    expect(validateDoc(emptyDoc()).ok).toBe(true);
    expect(validateDoc(starterDoc()).ok).toBe(true);
  });

  it('ID重複を検出', () => {
    const doc = emptyDoc();
    const t = makeTask({ id: 'dup', name: 'x' });
    const t2 = makeTask({ id: 'dup', name: 'y' });
    doc.tasks = [t, t2];
    const res = validateDoc(doc);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('ID重複'))).toBe(true);
  });

  it('依存の参照不明を検出', () => {
    const doc = emptyDoc();
    const t = makeTask({ name: 'x' });
    doc.tasks = [t];
    doc.dependencies = [makeDep(t.id, 'missing')];
    const res = validateDoc(doc);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('successor不明'))).toBe(true);
  });

  it('milestone の duration!=0 を検出', () => {
    const doc = emptyDoc();
    // makeTask は milestone で強制0にするので、手で壊す
    const t = makeTask({ name: 'ms', isMilestone: true });
    (t as any).durationDays = 5;
    doc.tasks = [t];
    const res = validateDoc(doc);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('milestone'))).toBe(true);
  });

  it('循環（DAG違反）を検出', () => {
    const doc = emptyDoc();
    const a = makeTask({ name: 'a' });
    const b = makeTask({ name: 'b' });
    doc.tasks = [a, b];
    doc.dependencies = [makeDep(a.id, b.id), makeDep(b.id, a.id)];
    const res = validateDoc(doc);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('DAG違反'))).toBe(true);
  });

  it('Zod: 型不正（progress が範囲外）を弾く', () => {
    const doc: any = emptyDoc();
    const t = makeTask({ name: 'x' });
    (t as any).progress = 200;
    doc.tasks = [t];
    const res = validateDoc(doc);
    expect(res.ok).toBe(false);
  });

  it('Zod: 未知の構造（tasks欠落）を弾く', () => {
    const res = validateDoc({ schemaVersion: 1 });
    expect(res.ok).toBe(false);
  });
});
