import { test, expect } from '@playwright/test';

// §9.3 ガント: 表示中の依存を矢印で結ぶ（仮想化＝見えている行ペアだけ描画）。トグルで表示切替。
test('ガント依存矢印: 表示中ペアに矢印を描き、依存線トグルで消える', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // A→B→C の鎖を1つのWBSに作り、全展開してガントへ。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    const a = app.addTask({ wbsCode: '80', name: 'AR-A', durationDays: 5 }, { edit: false });
    const b = app.addTask({ wbsCode: '80', name: 'AR-B', durationDays: 4 }, { edit: false });
    const c = app.addTask({ wbsCode: '80', name: 'AR-C', durationDays: 3 }, { edit: false });
    app.addDependencyChecked(a.id, b.id);
    app.addDependencyChecked(b.id, c.id);
    app.setSelection({ taskId: null });
    app.setExpandLevel(9);
    app.setActiveView('gantt');
  });
  await expect(page.getByTestId('gantt-scroll')).toBeVisible();

  // 依存矢印が描画される（少なくとも2本）。
  await expect.poll(async () => await page.locator('.gantt-dep-line').count()).toBeGreaterThanOrEqual(2);

  // 「依存線」トグルで消える。
  await page.getByTestId('gantt-deps-toggle').click();
  await expect.poll(async () => await page.locator('.gantt-dep-line').count()).toBe(0);

  // 再度トグルで戻る。
  await page.getByTestId('gantt-deps-toggle').click();
  await expect.poll(async () => await page.locator('.gantt-dep-line').count()).toBeGreaterThanOrEqual(2);
});
