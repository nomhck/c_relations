import { test, expect } from '@playwright/test';

// 設計書 §8 / Phase5 下ごしらえ: MSPDI(MS Project XML) を出力し、そのファイルを取込で往復できる。
test('MSPDI: 出力→ファイル取込 で往復（新プロジェクトとして復元）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 既知タスク＋依存を追加。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    const a = app.addTask({ wbsCode: '77', name: 'MSPXTASK', durationDays: 6 }, { edit: false });
    const b = app.addTask({ wbsCode: '77', name: 'MSPYTASK', durationDays: 2 }, { edit: false });
    app.addDependencyChecked(a.id, b.id);
    app.setSelection({ taskId: null });
  });
  const beforeProjectId = await page.evaluate(() => (window as any).__APP.getState().project.id);

  // MSPDI出力（データメニュー→ダウンロード）。
  await page.getByTestId('data-menu').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /MSPDI出力/ }).click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();

  // そのファイルを MSPDI取込 → 新プロジェクトとして復元。
  await page.getByTestId('mspdi-file').setInputFiles(path!);

  // 別プロジェクトIDになり、タスク/依存が復元される。
  await expect
    .poll(() => page.evaluate(() => (window as any).__APP.getState().project.id))
    .not.toBe(beforeProjectId);
  const state = await page.evaluate(() => {
    const s = (window as any).__APP.getState();
    return {
      hasX: s.tasks.some((t: any) => t.name === 'MSPXTASK' && t.durationDays === 6),
      hasY: s.tasks.some((t: any) => t.name === 'MSPYTASK'),
      deps: s.dependencies.length,
    };
  });
  expect(state.hasX).toBe(true);
  expect(state.hasY).toBe(true);
  expect(state.deps).toBeGreaterThanOrEqual(1);
});
