import { test, expect, type Page } from '@playwright/test';

// 設計書 §12.4 / §9.3 Phase 3（PR-G）: ガントが View Shell の第3タブに乗り、
// 行=deriveTableRows・バー=CPM es/ef・WBSサマリ=esMin/efMax・CP強調が効くことを実駆動で確認。

function tasksLen(page: Page) {
  return page.evaluate(() => (window as any).__APP.getState().tasks.length);
}

test('ガント: Yショートカット→軸/バー描画→CPのみで全バー critical', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 4,000デモ生成
  await page.evaluate(() => (window as any).__APP.getState().generateDemo());
  await expect.poll(async () => await tasksLen(page)).toBe(4000);
  await page.evaluate(() => (window as any).__APP.getState().setExpandLevel(9));

  // Y ショートカットでガントへ
  await page.locator('body').click();
  await page.keyboard.press('y');
  await expect.poll(async () => page.evaluate(() => (window as any).__APP.getState().activeView)).toBe(
    'gantt',
  );
  await expect(page.getByTestId('gantt-scroll')).toBeVisible();

  // 日付軸（月目盛り yyyy-mm）が出る
  await expect(page.locator('.gantt-tick').first()).toBeVisible();
  await expect(page.locator('.gantt-tick > span').first()).toHaveText(/\d{4}-\d{2}/);

  // タスクバー（CPM es/ef 由来）が描画される
  await expect.poll(async () => await page.locator('.gantt-bar').count()).toBeGreaterThan(1);

  // CPのみ表示 → 表示中のバーはすべて critical（背骨だけ残る）
  await page.evaluate(() => (window as any).__APP.getState().quickCriticalOnly());
  await expect
    .poll(async () => {
      const total = await page.locator('.gantt-bar').count();
      const crit = await page.locator('.gantt-bar.crit').count();
      return total > 0 && total === crit;
    })
    .toBe(true);
});
