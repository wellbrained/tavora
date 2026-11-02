// Undo instead of "Are you sure?": layouts, folders and workspaces are deleted at once and a toast offers Undo for a
// few seconds (modules/shared/src/undoable.ts, main/undo-shelf.ts).
import { expect, test, type Page } from "@playwright/test";
import { launch, layOutColumns, openModule, openWorkspace, VANILLA } from "./harness";

async function fromMenu(page: Page, gameId: string, ...items: string[]) {
  await page.getByTestId(`rail-workspace-${gameId}`).click({ button: "right" });
  for (const item of items) await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
}

const rail = (page: Page) =>
  page.locator('[data-testid^="rail-workspace-"], [data-testid^="rail-folder-"][data-testid$="-toggle"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-testid")));
const toasts = (page: Page) => page.getByTestId("undo-toast");
const layoutNames = async (page: Page) => {
  await page.getByTestId("layouts").click();
  const names = await page.locator('[role="menu"][data-state="open"] [role="menuitem"]').allTextContents();
  await page.keyboard.press("Escape");
  return names;
};

test("a deleted layout comes back with Undo into its own workspace, after a switch; closing Tavora makes it final", async () => {
  const { app, page, userData } = await launch();
  await layOutColumns(page, 2);
  await openModule(page, VANILLA);
  for (const name of ["Builds", "Bossing"]) {
    await page.getByTestId("layouts").click();
    await page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]').click();
    await page.getByTestId("prompt-input").fill(name);
    await page.getByTestId("prompt-submit").click();
    await expect(page.getByTestId("prompt")).toHaveCount(0);
  }
  const deleteLayout = async (name: string) => {
    await page.getByTestId("layouts").click();
    await page.locator('[role="menu"][data-state="open"]').getByText(name, { exact: true }).click();
    await page.locator('[role="menu"][data-state="open"] [data-testid="layout-delete"]').click();
  };

  await deleteLayout("Builds");
  // No question first; the toast says what happened and offers Undo, which says its key.
  await expect(page.getByTestId("confirm")).toHaveCount(0);
  await expect(toasts(page)).toContainText("Layout deleted");
  await expect(page.getByTestId("undo")).toHaveAttribute("aria-keyshortcuts", "Control+Z");
  expect((await layoutNames(page)).join()).not.toContain("Builds");

  // Undo after switching to another workspace puts it back where it was deleted, in its place.
  await openWorkspace(page, "satisfactory");
  await page.getByTestId("undo").click();
  await expect(toasts(page)).toHaveCount(0);
  await openWorkspace(page, "poe2");
  const names = (await layoutNames(page)).join("|");
  expect(names.indexOf("Builds")).toBeGreaterThanOrEqual(0);
  expect(names.indexOf("Builds")).toBeLessThan(names.indexOf("Bossing"));

  // Deleted, and Tavora closes while Undo is still offered: it stays deleted, and whole.
  await deleteLayout("Bossing");
  await expect(toasts(page)).toContainText("Layout deleted");
  await app.close();
  const again = await launch(userData);
  const after = (await layoutNames(again.page)).join("|");
  expect(after).toContain("Builds");
  expect(after).not.toContain("Bossing");
  await expect(toasts(again.page)).toHaveCount(0);
  await again.app.close();
});

test("two workspaces removed one after the other each have their own Undo, by Ctrl+Z or the button, back in place", async () => {
  const { app, page } = await launch();
  const before = await rail(page);
  await expect(page.getByTestId("welcome")).toHaveCount(0);

  await fromMenu(page, "poe2", "menu-remove");
  await expect(page.getByTestId("confirm")).toHaveCount(0);
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveCount(0);
  await expect(page.getByTestId("welcome")).toBeVisible();
  await fromMenu(page, "satisfactory", "menu-remove");
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveCount(0);
  await expect(toasts(page)).toHaveCount(2);
  await expect(toasts(page).last()).toContainText("Satisfactory moved to Trash");

  // Ctrl+Z takes back the newest only; the other stays in Trash and keeps its own Undo.
  await page.locator("body").press("Control+z");
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveCount(1);
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveCount(0);
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText("Path of Exile 2 moved to Trash");

  // The button brings back the first, above the other as before, and opens it again: it was the open one.
  await page.getByTestId("undo").click();
  await expect.poll(() => rail(page)).toEqual(before);
  await expect(page.getByTestId("welcome")).toHaveCount(0);
  await expect(toasts(page)).toHaveCount(0);

  // Pressed again with nothing left to undo, Ctrl+Z does nothing.
  await page.locator("body").press("Control+z");
  await expect.poll(() => rail(page)).toEqual(before);
  await app.close();
});

test("a deleted folder comes back with its workspaces; the toast's time running out makes it final", async () => {
  const { app, page } = await launch();
  await fromMenu(page, "satisfactory", "menu-move-to-folder", "menu-new-folder");
  await page.getByTestId("prompt-input").fill("Factory");
  await page.getByTestId("prompt-submit").click();
  const folder = page.locator('[data-testid^="rail-folder-"][data-testid$="-toggle"]');
  await expect(folder).toHaveCount(1);
  const before = await rail(page);

  const deleteFolder = async () => {
    await folder.click({ button: "right" });
    await page.locator('[role="menu"][data-state="open"] [data-testid="menu-delete-folder"]').click();
  };
  await deleteFolder();
  await expect(page.getByTestId("confirm")).toHaveCount(0);
  await expect(folder).toHaveCount(0);
  await expect(toasts(page)).toContainText("Folder deleted");
  await page.getByTestId("undo").click();
  await expect.poll(() => rail(page)).toEqual(before);

  await deleteFolder();
  await expect(folder).toHaveCount(0);
  // Five seconds, then the toast goes and Undo with it.
  await expect(toasts(page)).toHaveCount(0, { timeout: 8000 });
  await page.locator("body").press("Control+z");
  await page.waitForTimeout(300);
  await expect(folder).toHaveCount(0);
  await app.close();
});
