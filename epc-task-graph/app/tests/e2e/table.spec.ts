import { test, expect, type Page } from '@playwright/test';

// 設計書 §12.6 PR-T1 受入基準のスモーク:
// タブ切替 → 4,000生成 → 仮想化(実DOM行≤50) → フィルタ反映 → 行選択がグラフと同期 →
// インライン編集(ストアアクション経由・Undo可) → リロード復元 のうち可能な範囲を実駆動で確認。

function tasksLen(page: Page) {
  return page.evaluate(() => (window as any).__APP.getState().tasks.length);
}
function selTaskId(page: Page) {
  return page.evaluate(() => (window as any).__APP.getState().selection.taskId);
}
function nameOf(page: Page, id: string) {
  return page.evaluate(
    (tid) => (window as any).__APP.getState().tasks.find((t: any) => t.id === tid)?.name,
    id,
  );
}

test('テーブル: タブ切替→4000→仮想化→フィルタ→選択同期→インライン編集→Undo', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // ---- タブ切替（グラフ⇄テーブル・display切替で常駐マウント）----
  await page.getByTestId('viewtab-table').click();
  await expect(page.getByTestId('table-scroll')).toBeVisible();

  // ---- 4,000ノード生成 → テーブルへ反映 ----
  const t0 = Date.now();
  await page.getByRole('button', { name: '4,000ノード生成' }).click();
  await expect.poll(async () => await tasksLen(page)).toBe(4000);
  // 全WBS展開（4,000タスク行＋WBS行で仮想化を実スケール検証。既定は Lv2 集約）。
  await page.evaluate(() => (window as any).__APP.getState().setExpandLevel(9));
  // 最初のタスク行が現れるまで（初期表示）
  await expect(page.locator('.trow:not(.trow-wbs)').first()).toBeVisible();
  const initialMs = Date.now() - t0;
  console.log('[table] 4000生成→全展開→初期表示 wall-clock =', initialMs, 'ms');

  // ---- (a) 仮想化: 実DOM行が視界＋オーバースキャン分だけ（≤50。総行数は4,000超）----
  await expect.poll(async () => await page.getByTestId('table-count').innerText()).toMatch(/全 4000/);
  const domRows = await page.locator('.trow').count();
  console.log('[table] 実DOM .trow 行数 =', domRows);
  expect(domRows).toBeGreaterThan(0);
  expect(domRows).toBeLessThanOrEqual(50);

  // ---- (b) フィルタ反映（ISOLATE + 工種E）: タスク行数が 4,000 未満へ ----
  await page.evaluate(() => {
    const app = (window as any).__APP;
    app.getState().setDisplayMode('ISOLATE');
    app.getState().setFilter({ disciplines: ['E'] });
  });
  await expect
    .poll(async () => {
      const txt = await page.getByTestId('table-count').innerText();
      const m = txt.match(/タスク\s*(\d+)/);
      return m ? Number(m[1]) : -1;
    })
    .toBeLessThan(4000);
  // フィルタ解除して以降の編集を安定化
  await page.evaluate(() => (window as any).__APP.getState().clearFilter());

  // ---- (d) 行選択 ⇄ ノード選択の同期＋タブ往復で保持 ----
  const firstRow = page.locator('.trow:not(.trow-wbs)').first();
  const rowId = await firstRow.getAttribute('data-id');
  expect(rowId).toBeTruthy();
  await firstRow.click();
  await expect.poll(async () => await selTaskId(page)).toBe(rowId);
  // グラフへ切替 → 選択保持
  await page.getByTestId('viewtab-graph').click();
  expect(await selTaskId(page)).toBe(rowId);
  // テーブルへ戻る → 選択保持
  await page.getByTestId('viewtab-table').click();
  expect(await selTaskId(page)).toBe(rowId);

  // ---- (e) インライン編集（ダブルクリック→入力→Enter）＝ updateTask 経由 ----
  const nameCell = page.locator(`.trow[data-id="${rowId}"] .tcell-name`);
  await nameCell.dblclick();
  const input = page.locator('.trow input.task-name-input');
  await expect(input).toBeVisible();
  await input.fill('テーブル編集A');
  await input.press('Enter');
  await expect.poll(async () => await nameOf(page, rowId!)).toBe('テーブル編集A');
  // Enter の「次行へ前進」で開いた編集をキャンセルしてフォーカスを外す
  await page.keyboard.press('Escape');
  await page.locator('.table-toolbar').click();

  // ---- Undo（全ビュー共通・Cmd/Ctrl+Z）で編集が1確定=1単位で戻る ----
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(async () => await nameOf(page, rowId!)).not.toBe('テーブル編集A');
});
