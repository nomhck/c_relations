import { test, expect } from '@playwright/test';

// 設計書 §2.8/§12.3.8 PR-T2④: 現在のフィルタ/表示/折り畳み＋テーブルのソート/列を名前付きで
// 保存し、適用で復元できる（保存ビュー機能。Phase1 の欠けていた土台）。

test('保存ビュー: フィルタ/ソートを保存→クリア→適用で復元→削除', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // ISOLATE + 工種E + テーブルソート(name) を設定して保存。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    app.setDisplayMode('ISOLATE');
    app.setFilter({ disciplines: ['E'] });
    app.setTableSort([{ key: 'name', dir: 'asc' }]);
  });
  await page.getByTestId('saveview-name').fill('Eのみ');
  await page.getByTestId('saveview-btn').click();
  await expect(page.getByTestId('saveview-list')).toContainText('Eのみ');

  // 状態をクリア。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    app.clearFilter();
    app.setDisplayMode('DIM');
    app.setTableSort([]);
  });

  // 保存ビューを適用 → 復元される。
  await page.locator('.sv-item .name', { hasText: 'Eのみ' }).click();
  const restored = await page.evaluate(() => {
    const s = (window as any).__APP.getState();
    return {
      disc: s.viewSpec.filter.disciplines,
      mode: s.viewSpec.displayMode,
      sortKey: s.tableSort[0]?.key,
    };
  });
  expect(restored.disc).toEqual(['E']);
  expect(restored.mode).toBe('ISOLATE');
  expect(restored.sortKey).toBe('name');

  // 削除 → 一覧が消える（「まだありません」表示に戻る）。
  await page.locator('.sv-item', { hasText: 'Eのみ' }).locator('.x').click();
  await expect(page.getByTestId('saveview-list')).toHaveCount(0);
});

// §2.8 実用化: 保存ビューを★で「既定」に指定→リロードで自動適用（毎回"自分の入口"で開く）。
test('既定ビュー: ★指定→リロードで起動時に自動適用される', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 工種P + ISOLATE で保存し、★（既定）に指定。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    app.setDisplayMode('ISOLATE');
    app.setFilter({ disciplines: ['P'] });
  });
  await page.getByTestId('saveview-name').fill('調達だけ');
  await page.getByTestId('saveview-btn').click();
  await page.locator('.sv-item', { hasText: '調達だけ' }).locator('.sv-star').click();
  // localStorage に既定ビューIDが入る。
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('epc-app-default-view')))
    .not.toBeNull();
  // 保存ビュー本体が Dexie に書かれる（デバウンス500ms）のを待つ＝リロード後も残る前提。
  await expect(page.getByTestId('savebadge')).toHaveText(/保存済み/);

  // フィルタを解除してからリロード → 起動時に既定ビューが自動適用され P/ISOLATE が復元。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    app.clearFilter();
    app.setDisplayMode('DIM');
  });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__APP);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as any).__APP.getState();
        return { disc: s.viewSpec.filter.disciplines, mode: s.viewSpec.displayMode };
      }),
    )
    .toEqual({ disc: ['P'], mode: 'ISOLATE' });
});
