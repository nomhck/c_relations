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

  // 編集入力が閉じてフォーカスが外れてから Tab（入力にフォーカス中はグラフの Tab 経路が無効）。
  await expect(page.locator('input.task-name-input')).toBeHidden();

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

  await page.evaluate(() => (window as any).__APP.getState().generateDemo());
  await expect.poll(async () => (await counts(page)).tasks).toBe(4000);

  // デザイン刷新の回帰ガード: 俯瞰（Lv2集約30件）が灰色LOD箱でなく判読可能な
  // 集約カードとして描画される（グリッド整列で読める倍率に収まる）。
  await expect.poll(async () => await page.locator('.agg-card').count()).toBeGreaterThan(10);
  const firstCard = page.locator('.agg-card .agg-prefix').first();
  await expect(firstCard).toBeVisible();
  await expect(firstCard).toHaveText(/\d/); // WBSプレフィックス（数字を含む）

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

  // 統計は「詳細設定」に折り畳まれているため開く。
  await page.getByTestId('details-toggle').click();
  // 統計パネルの可視数が数十〜数百（4,000 の半分未満）へ
  await expect
    .poll(async () => {
      const txt = await page.getByTestId('visible-count').innerText();
      const m = txt.match(/表示ノード:\s*(\d+)/);
      return m ? Number(m[1]) : -1;
    })
    .toBeLessThan(2000);
});

test('CPのみ表示で背骨チェーンが抽出される（§9.2 / PR4）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 余裕ありのダイヤ A(2)→B(4)→D(1), A→C(2)→D を作る（背骨=A,B,D、C は TF=2 で除外）。
  await page.evaluate(async () => {
    const app = (window as any).__APP;
    await app.getState().newProject('CPテスト');
    const s = () => app.getState();
    const A = s().addTask({ name: 'A', durationDays: 2, position: { x: 0, y: 0 } }, { edit: false });
    const B = s().addTask({ name: 'B', durationDays: 4, position: { x: 220, y: 0 } }, { edit: false });
    const C = s().addTask({ name: 'C', durationDays: 2, position: { x: 220, y: 160 } }, { edit: false });
    const D = s().addTask({ name: 'D', durationDays: 1, position: { x: 440, y: 0 } }, { edit: false });
    s().addDependencyChecked(A.id, B.id);
    s().addDependencyChecked(B.id, D.id);
    s().addDependencyChecked(A.id, C.id);
    s().addDependencyChecked(C.id, D.id);
  });

  // 全4タスクが揃うのを待つ
  await expect.poll(async () => (await counts(page)).tasks).toBe(4);

  // 「CPのみ」ビュー適用 → 背骨（A,B,D）の3ノードだけが表示される
  await page.getByRole('button', { name: 'CPのみ' }).click();
  // 統計は「詳細設定」に折り畳まれているため開く。
  await page.getByTestId('details-toggle').click();
  await expect
    .poll(async () => {
      const txt = await page.getByTestId('visible-count').innerText();
      const m = txt.match(/表示ノード:\s*(\d+)/);
      return m ? Number(m[1]) : -1;
    })
    .toBe(3);

  // クリティカル強調（赤ノード）が描画される
  await expect(page.locator('.task-node.critical').first()).toBeVisible();

  // ヘッダの完了日サマリが実値を表示（—未計算ではない）
  const completion = await page.getByTestId('completion').innerText();
  expect(completion).toMatch(/完了日:\s*\d{4}-\d{2}-\d{2}/);
});
