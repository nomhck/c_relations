import { test, expect, type Page } from '@playwright/test';

// 設計書 §10 共通ルールのスモーク: 起動 → ノード作成 → 接続 → リロード後残存。
// UI 操作（キーボード）で実際に駆動し、状態は露出した window.__APP から検証する。

function counts(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__APP.getState();
    return { tasks: s.tasks.length, deps: s.dependencies.length };
  });
}

// 注: Playwright は各テストに独立したブラウザコンテキストを与えるため localStorage は初期状態で空。
// （addInitScript でのクリアはリロード時にも走り保存を消してしまうため使わない）

test('起動→タスク作成→後続接続→リロード後も残存する', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);
  await expect(page.locator('.react-flow__pane')).toBeVisible();

  const base = await counts(page);
  expect(base.tasks).toBeGreaterThan(0); // スターター4件

  // ツールバー「＋タスク」で新規タスク作成（ビューポート中央・インライン編集状態）→ 名前入力 → Enter 確定
  await page.getByRole('button', { name: '＋タスク' }).click();
  const input = page.locator('input.task-name-input');
  await expect(input).toBeVisible();
  await input.fill('E2E作成タスク');
  await input.press('Enter');

  await expect.poll(async () => (await counts(page)).tasks).toBe(base.tasks + 1);

  // 選択中タスクから Tab で後続タスク＋依存を自動生成（§1.2-6 連続作成）
  await page.keyboard.press('Tab');
  const nameForSucc = page.locator('input.task-name-input');
  await expect(nameForSucc).toBeVisible();
  await nameForSucc.press('Enter');

  await expect.poll(async () => await counts(page)).toEqual({
    tasks: base.tasks + 2,
    deps: base.deps + 1,
  });

  // 自動保存の完了を待つ（デバウンス500ms → 保存済みバッジ）
  await expect(page.getByTestId('savebadge')).toHaveText(/保存済み/);

  // リロードして localStorage から復元されることを確認
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__APP);
  await expect.poll(async () => await counts(page)).toEqual({
    tasks: base.tasks + 2,
    deps: base.deps + 1,
  });

  // 作成したタスク名が復元後も存在する
  const hasName = await page.evaluate(() =>
    (window as any).__APP.getState().tasks.some((t: any) => t.name === 'E2E作成タスク'),
  );
  expect(hasName).toBe(true);
});

test('4,000デモ生成→ISOLATEフィルタで可視数が大幅に減る（§10 受入(e)）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  await page.getByRole('button', { name: '4,000ノード生成' }).click();
  await expect.poll(async () => (await counts(page)).tasks).toBe(4000);

  // ISOLATE + 担当1部署でフィルタ
  const visible = await page.evaluate(() => {
    const app = (window as any).__APP;
    const dept = app.getState().tasks[0].assignee;
    app.getState().setDisplayMode('ISOLATE');
    app.getState().setFilter({ assignees: [dept] });
    // deriveVisibleGraph は左パネル統計に反映される
    return dept;
  });
  expect(visible).toBeTruthy();

  // 統計パネルの可視数が数十〜数百（4,000 の半分未満）へ
  await expect
    .poll(async () => {
      const txt = await page.getByTestId('visible-count').innerText();
      const m = txt.match(/表示ノード:\s*(\d+)/);
      return m ? Number(m[1]) : -1;
    })
    .toBeLessThan(2000);
});
