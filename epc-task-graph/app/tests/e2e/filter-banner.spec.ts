import { test, expect } from '@playwright/test';

// 「filter したものだけを分かりやすく」: 絞り込み状態バナー（何で絞っているか・件数・ワンクリック解除）。
test('フィルタバナー: 絞り込むと内容と件数が明示され、ワンクリックで解除できる', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 未フィルタ時はバナーなし。
  await expect(page.getByTestId('filter-banner')).toHaveCount(0);

  // 工種E + ISOLATE で絞る。
  await page.evaluate(() => {
    const s = (window as any).__APP.getState();
    s.setDisplayMode('ISOLATE');
    s.setFilter({ disciplines: ['E'] });
  });

  // バナーが「絞り込み中 / 工種: E / N件 / すべて表示」を表示。
  const banner = page.getByTestId('filter-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('絞り込み中');
  await expect(banner).toContainText('工種: E');
  await expect(page.getByTestId('filter-count')).toHaveText(/\d+件/);

  // 「すべて表示 ✕」でフィルタ解除 → バナー消える。
  await page.getByTestId('filter-clear').click();
  await expect(page.getByTestId('filter-banner')).toHaveCount(0);
  const cleared = await page.evaluate(() => (window as any).__APP.getState().viewSpec.filter);
  expect(Object.keys(cleared).length).toBe(0);
});
