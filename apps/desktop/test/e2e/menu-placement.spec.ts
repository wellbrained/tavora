import { test, expect } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
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
    const onScreen = () => viewsOnScreen(app);
    await expect.poll(onScreen).toBeGreaterThan(0);
    // Looks at every frame: the first one that draws the menu is when a panel must already be out of the way.
    await page.evaluate(() => {
      const w = window as unknown as { __menuFrame?: number };
      const look = () => {
        const menu = document.querySelector('[role="menu"][data-state="open"]');
        if (menu && Number(getComputedStyle(menu).opacity) > 0) w.__menuFrame = performance.now();
        else requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.getByTestId("rail-workspace-poe2").click({ button: "right" });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __menuFrame?: number }).__menuFrame ?? 0)).toBeGreaterThan(0);
    expect(await onScreen()).toBe(0);
    await expect(page.locator("html")).not.toHaveClass(/overlay-pending/);
    await page.keyboard.press("Escape");
    await expect.poll(onScreen).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

/** How many module views are on screen right now (asked of the main process). */
const viewsOnScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .flatMap((window) => window.contentView.children)
      .filter((view) => (view as unknown as { webContents?: { getURL(): string } }).webContents?.getURL().startsWith("tavora-module://"))
      .filter((view) => (view as unknown as { getVisible(): boolean }).getVisible()).length,
  );

test("a dropdown opened with the keyboard over a panel waits for the panel, then takes the arrow keys", async () => {
  const { app, page } = await launch();
  try {
    await page.getByTestId("empty-template-main-stacked").click();
    await openModule(page, VANILLA);
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
    await page.getByTestId("layouts").focus();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId("menu");
    await expect(menu).toBeVisible();
    // Shown only once nothing covers it, and not before the keyboard is in it.
    await expect(page.locator("html")).not.toHaveClass(/overlay-pending/);
    expect(await viewsOnScreen(app)).toBe(0);
    const highlighted = () => menu.locator("[data-highlighted]").first().innerText();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="menu"]') !== null)).toBe(true);
    await page.keyboard.press("ArrowDown");
    const first = await highlighted();
    await page.keyboard.press("ArrowDown");
    await expect.poll(highlighted).not.toBe(first);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test("a submenu over a panel shows only once the panel has stepped aside", async () => {
  const { app, page } = await launch();
  try {
    await page.getByTestId("empty-template-main-stacked").click();
    await openModule(page, VANILLA);
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
    await page.getByTestId("layouts").click();
    await expect(page.getByTestId("menu")).toBeVisible();
    await page.getByTestId("layout-templates").hover();
    await page.getByTestId("layout-templates").press("ArrowRight");
    await expect(page.locator('[data-slot="dropdown-menu-sub-content"]')).toBeVisible();
    expect(await viewsOnScreen(app)).toBe(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
