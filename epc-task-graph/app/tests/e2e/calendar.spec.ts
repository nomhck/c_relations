import { test, expect } from '@playwright/test';

// 設計書 §9.1/Phase2・ユーザー要望「土日も稼働日になることがある」: 稼働曜日を設定でき、
// CPM が非稼働日を跨いで暦日で伸ばす／土日を稼働にすると線形に戻ることを実駆動で確認。

test('稼働カレンダー: 週休2日で週末を跨ぐ作業が、土日を稼働にすると短縮される', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 基準日を月曜(2026-01-05)に固定し、6稼働日のタスクを作成・選択。
  await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    app.setDataDate('2026-01-05');
    const t = app.addTask({ wbsCode: '94', name: 'CAL', durationDays: 6 });
    app.setSelection({ taskId: t.id });
  });

  // 既定=週休2日(月〜金)。月開始の6稼働日は土日を跨いで EF=+8d。
  await expect(page.getByTestId('cpm-es')).toContainText('+8d');

  // 土(index6)・日(index0)を稼働日に切替 → 全曜日稼働＝線形で EF=+6d。
  const wd = page.getByTestId('workingdays').locator('.wd-btn');
  await wd.nth(6).click(); // 土
  await wd.nth(0).click(); // 日
  await expect(page.getByTestId('cpm-es')).toContainText('+6d');
});
