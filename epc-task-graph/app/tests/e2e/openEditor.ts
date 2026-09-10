import type { Page } from "@playwright/test";
/** Enter the editor explicitly; the redesigned product starts on the project overview. */
export async function openEditor(page: Page) {
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "依存関係", exact: true })
    .click();
  await page.getByRole("button", { name: "絞り込み", exact: true }).click();
}
