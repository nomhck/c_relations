import { test, expect, type Page } from '@playwright/test';

// 設計書 §1.3/§2.7: WBSツリーパネルで階層を辿り、ノードクリックでそのサブツリーに絞り込み。
function wbsFilter(page: Page) {
  return page.evaluate(() => (window as any).__APP.getState().viewSpec.filter.wbsPrefixes ?? null);
}

test('WBSツリー: 展開してノードクリックで wbsPrefixes 絞り込み（再クリックで解除）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 既知のWBS階層を作る（1.1, 1.2, 2.1）。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    app.addTask({ wbsCode: '1.1', name: 'WA' }, { edit: false });
    app.addTask({ wbsCode: '1.2', name: 'WB' }, { edit: false });
    app.addTask({ wbsCode: '2.1', name: 'WC' }, { edit: false });
  });

  const tree = page.getByTestId('wbs-tree');
  await expect(tree).toBeVisible();
  // トップレベル '1' が出る。
  await expect(tree.locator('[data-prefix="1"]')).toBeVisible();

  // '1' の行のトグルを押して展開 → 子 '1.1' が現れる。
  await tree.locator('.wbs-tree-row:has([data-prefix="1"]) .wbs-tree-tog').click();
  await expect(tree.locator('[data-prefix="1.1"]')).toBeVisible();

  // '1.1' クリック → wbsPrefixes=['1.1']。
  await tree.locator('[data-prefix="1.1"]').click();
  await expect.poll(async () => await wbsFilter(page)).toEqual(['1.1']);

  // 再クリックで解除。
  await tree.locator('[data-prefix="1.1"]').click();
  await expect.poll(async () => await wbsFilter(page)).toBeNull();
});
