import { test, expect } from '@playwright/test';

// 初回オンボーディング。自動テスト(navigator.webdriver=true)では出さない＝既存フローを妨げない。
test('オンボーディング: 自動テスト環境では表示されない（既存操作を妨げない）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);
  // Playwright は navigator.webdriver=true なので出ない。
  await expect(page.getByTestId('onboarding')).toHaveCount(0);
});

test('オンボーディング: webdriverを偽装すると表示され、担当選択で自分のスライスへ', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  await expect(page.getByTestId('onboarding')).toBeVisible();
  // 担当を入力して「始める」→ 担当ISOLATE＋前後1（自分のタスク相当）が効く。
  await page.getByTestId('onboard-dept').fill('設計1課');
  await page.getByTestId('onboard-start').click();
  await expect(page.getByTestId('onboarding')).toHaveCount(0);
  const st = await page.evaluate(() => {
    const s = (window as any).__APP.getState();
    return { me: s.me, disc: s.viewSpec.filter.assignees, mode: s.viewSpec.displayMode, bu: s.viewSpec.boundaryUp };
  });
  expect(st.me).toBe('設計1課');
  expect(st.disc).toEqual(['@me']);
  expect(st.mode).toBe('ISOLATE');
  expect(st.bu).toBe(1);

  // 再訪では出ない（localStorage フラグ）。
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__APP);
  await expect(page.getByTestId('onboarding')).toHaveCount(0);
  await ctx.close();
});
