import { test, expect } from '@playwright/test';

// 設計書 §2.6・Phase1 PR5-8: Cmd/Ctrl+K の検索パレットで名前/WBS/担当からタスクへジャンプ。
test('検索パレット: Cmd/Ctrl+K で開き、Enter でタスクへ移動する', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  const id = await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    const t = app.addTask({ wbsCode: '96', name: 'ZZUNIQUETASK' }, { edit: false });
    app.setSelection({ taskId: null });
    return t.id;
  });

  await page.locator('body').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await expect(page.getByTestId('search-input')).toBeVisible();

  await page.getByTestId('search-input').fill('ZZUNIQUE');
  await expect(page.getByTestId('search-results')).toContainText('ZZUNIQUETASK');

  await page.getByTestId('search-input').press('Enter');
  // 選択が対象タスクへ移り、パレットは閉じる。
  await expect.poll(() => page.evaluate(() => (window as any).__APP.getState().selection.taskId)).toBe(id);
  await expect(page.getByTestId('search-input')).toHaveCount(0);
});
