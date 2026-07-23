import { test, expect, type Page } from '@playwright/test';

// 設計書 §9.3「ガント＝閲覧＋duration変更まで」: バー右端ハンドルのドラッグで所要日数を編集できる。
function durOf(page: Page, id: string) {
  return page.evaluate(
    (tid) => (window as any).__APP.getState().tasks.find((t: any) => t.id === tid)?.durationDays,
    id,
  );
}

test('ガント: バー右端をドラッグして所要日数を伸ばす', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__APP);

  // 全曜日稼働（線形＝バー幅と日数が一致）で決定的に。dur5 のタスクを作成しガントへ。
  const id = await page.evaluate(() => {
    const app = (window as any).__APP.getState();
    app.updateCalendar({ workingDays: [0, 1, 2, 3, 4, 5, 6] });
    app.setDataDate('2026-01-05');
    const t = app.addTask({ wbsCode: '95', name: 'GD', durationDays: 5 });
    app.setSelection({ taskId: t.id });
    app.setActiveView('gantt');
    return t.id;
  });
  await expect(page.getByTestId('gantt-scroll')).toBeVisible();
  expect(await durOf(page, id)).toBe(5);

  // 対象行のハンドルを +24px（dayWidth=4 → +6日）ドラッグ → dur 5+6=11。
  const handle = page.locator(`.gantt-track[data-id="${id}"] .gantt-bar-handle`);
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 24, cy, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => await durOf(page, id)).toBe(11);
});
