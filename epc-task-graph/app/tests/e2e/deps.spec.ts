import { test, expect, type Page } from '@playwright/test';

// 設計書 §2.9 第二経路・ユーザー要望③: 右パネルから GUI で依存を接続/切断できる。
function depsLen(page: Page) {
  return page.evaluate(() => (window as any).__APP.getState().dependencies.length);
}

test('依存: 右パネルの検索コンボで後続を追加→×で削除', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 2タスクを用意（依存なし）。A を選択。
  const ids: string[] = await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    const a = app.addTask({ wbsCode: '90', name: 'DEP元A' });
    const b = app.addTask({ wbsCode: '90', name: 'DEP先B' });
    app.setSelection({ taskId: a.id });
    return [a.id, b.id];
  });
  const before = await depsLen(page);

  // 後続アダーで「DEP先B」を検索してクリック → A→B の依存が1本増える。
  await page.getByPlaceholder('＋後続を追加（名前/WBSで検索）').fill('DEP先B');
  await page.locator('.depadder-item', { hasText: 'DEP先B' }).first().click();
  await expect.poll(async () => await depsLen(page)).toBe(before + 1);
  const created = await page.evaluate(
    (p) =>
      (window as any).__APP
        .getState()
        .dependencies.some((d: any) => d.predecessorId === p[0] && d.successorId === p[1]),
    ids,
  );
  expect(created).toBe(true);

  // 後続一覧の × で削除 → 元に戻る。
  await page.locator('.depitem', { hasText: 'DEP先B' }).locator('.x').click();
  await expect.poll(async () => await depsLen(page)).toBe(before);
});

test('依存: 循環になる接続はコンボから追加できない（拒否トースト）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);
  // A→B を作り、B 選択で「後続に A」を足そうとすると循環 → 拒否。
  const ids: string[] = await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    const a = app.addTask({ wbsCode: '91', name: 'CYCA' });
    const b = app.addTask({ wbsCode: '91', name: 'CYCB' });
    app.addDependencyChecked(a.id, b.id); // A→B
    app.setSelection({ taskId: b.id });
    return [a.id, b.id];
  });
  const before = await depsLen(page);
  await page.getByPlaceholder('＋後続を追加（名前/WBSで検索）').fill('CYCA');
  await page.locator('.depadder-item', { hasText: 'CYCA' }).first().click();
  // 循環拒否なので本数は変わらない。
  await expect.poll(async () => await depsLen(page)).toBe(before);
  expect(ids.length).toBe(2);
});
