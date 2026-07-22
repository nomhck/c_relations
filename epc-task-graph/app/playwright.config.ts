import { defineConfig, devices } from '@playwright/test';

// Playwright スモーク（設計書 §10 共通ルール: 起動→ノード作成→接続→リロード後残存）。
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 永続化系（デバウンス保存→リロード復元）は負荷次第でタイミングに敏感なため1回リトライ。
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
