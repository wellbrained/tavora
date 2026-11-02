import { test, expect } from "@playwright/test";
import { launch, openModule, panels, VANILLA } from "./harness";

test("a right-click menu opens next to its element, not at the pointer", async () => {
  const { app, page } = await launch();
  try {
    const icon = page.getByTestId("rail-workspace-poe2");
    const box = (await icon.boundingBox())!;
    // Right-click near the icon's left edge: a menu at the pointer would cover the icon.
    await icon.click({ button: "right", position: { x: 4, y: box.height / 2 } });
    const menu = page.locator('[role="menu"][data-state="open"]');
    await expect(menu).toBeVisible();
    const card = (await menu.boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(box.x + box.width);
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
  }
});

test("a host menu over a module panel shows only once the panel has stepped aside", async () => {
  const { app, page } = await launch();
  try {
    await page.getByTestId("empty-template-main-stacked").click();
    await openModule(page, VANILLA);
    await expect(panels(page, VANILLA)).toBeVisible();
    // How many module views are on screen right now (from the main process).
    const viewsOnScreen = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .flatMap((window) => window.contentView.children)
          .filter((view) => (view as unknown as { webContents?: { getURL(): string } }).webContents?.getURL().startsWith("tavora-module://"))
          .filter((view) => (view as unknown as { getVisible(): boolean }).getVisible()).length,
      );
    await expect.poll(viewsOnScreen).toBeGreaterThan(0);
    // Looks at every frame: the first one that draws the menu is when a panel must already be out of the way.
    await page.evaluate(() => {
      const w = window as unknown as { __menuFrame?: number };
      const look = () => {
        const menu = document.querySelector('[role="menu"][data-state="open"]');
        if (menu && getComputedStyle(menu).visibility !== "hidden") w.__menuFrame = performance.now();
        else requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.getByTestId("rail-workspace-poe2").click({ button: "right" });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __menuFrame?: number }).__menuFrame ?? 0)).toBeGreaterThan(0);
    expect(await viewsOnScreen()).toBe(0);
    await expect(page.locator("html")).not.toHaveClass(/overlay-pending/);
    await page.keyboard.press("Escape");
    await expect.poll(viewsOnScreen).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
