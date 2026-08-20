import { test, expect } from '@playwright/test';

// §2.9拡張「担当＋前後」: 担当で絞り、前後の受け渡し世代をステッパで調節して文脈に含める。
test('担当＋前後: 世代ステッパで受け渡し先の表示範囲が広がる', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // A(他)→B(自)→C(他)→D(他) の鎖。担当「自」= B のみ。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    const A = app.addTask({ name: 'A', assignee: '他', wbsCode: '1' }, { edit: false });
    const B = app.addTask({ name: 'B', assignee: '自', wbsCode: '1' }, { edit: false });
    const C = app.addTask({ name: 'C', assignee: '他', wbsCode: '1' }, { edit: false });
    const D = app.addTask({ name: 'D', assignee: '他', wbsCode: '1' }, { edit: false });
    app.addDependencyChecked(A.id, B.id);
    app.addDependencyChecked(B.id, C.id);
    app.addDependencyChecked(C.id, D.id);
    // 担当「自」でISOLATE、前後0（=Bのみ）。
    app.setDisplayMode('ISOLATE');
    app.setFilter({ assignees: ['自'] });
    app.setBoundary(0, 0);
  });

  const setBoundary = (up: number, down: number) =>
    page.evaluate(([u, d]) => (window as any).__APP.getState().setBoundary(u, d), [up, down]);

  // boundary 0/0 → 可視は B のみ（ISOLATE）。テーブルで確認。
  await page.getByTestId('viewtab-table').click();
  await page.evaluate(() => (window as any).__APP.getState().setExpandLevel(9));
  const taskNames = async () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.trow:not(.trow-wbs) .tname-text')).map((e) => e.textContent),
    );
  await expect.poll(async () => (await taskNames()).sort().join(',')).toBe('B');

  // 前1・後1 → A,B,C。
  await setBoundary(1, 1);
  await expect.poll(async () => (await taskNames()).sort().join(',')).toBe('A,B,C');

  // 後をさらに+1（前1・後2）→ A,B,C,D。
  await setBoundary(1, 2);
  await expect.poll(async () => (await taskNames()).sort().join(',')).toBe('A,B,C,D');

  // UIのステッパでも操作できる（後を−1して A,B,C に戻る）。
  await page.getByTestId('viewtab-graph').click();
  const downMinus = page.getByTestId('boundary').locator('.stepbtn').nth(2); // 後の「−」
  await downMinus.click();
  await page.getByTestId('viewtab-table').click();
  await expect.poll(async () => (await taskNames()).sort().join(',')).toBe('A,B,C');
});
