import { test, expect } from '@playwright/test';

// タブ横の操作マニュアル: 「まず絞る→それから見る」ワークフローとキー操作が確認できる。
test('操作マニュアル: 「？使い方」で開閉し、実運用ワークフローを表示', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  await expect(page.getByTestId('help-pop')).toHaveCount(0);
  await page.getByTestId('help-btn').click();
  const pop = page.getByTestId('help-pop');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('まず絞る');
  await expect(pop).toContainText('CPのみ');
  await expect(pop).toContainText('ビュー切替');

  // Esc で閉じる。
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help-pop')).toHaveCount(0);
});
