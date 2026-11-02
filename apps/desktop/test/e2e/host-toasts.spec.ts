// Tavora's own toasts ("Layout deleted · Undo") follow the position the user picked in Settings > Appearance, also over the
// panels: they are shown by a page of their own that sits on top of every panel (main/toast-view.ts), as big as the toasts
// only, so the panels around them still take the mouse.
import { expect, test, type Page } from "@playwright/test";
import { hostToast, launch, layOutColumns, openModule, toastsPage, viewStack, VANILLA, waitForShown, type Box } from "./harness";

async function saveLayout(page: Page, name: string) {
  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]').click();
  await page.getByTestId("prompt-input").fill(name);
  await page.getByTestId("prompt-submit").click();
  await expect(page.getByTestId("prompt")).toHaveCount(0);
}

/** Deletes a saved layout from its submenu: Tavora's toast says so, with Undo. */
async function deleteLayout(page: Page, name: string) {
  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"]').getByText(name, { exact: true }).click();
  await page.locator('[role="menu"][data-state="open"] [data-testid="layout-delete"]').click();
}

async function layoutNames(page: Page): Promise<string[]> {
  await page.getByTestId("layouts").click();
  await expect(page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]')).toBeVisible();
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"][data-state="open"] [data-testid^="layout-"]'))
      .filter((element) => /^layout-[0-9a-f]{8}-/.test(element.dataset.testid ?? ""))
      .map((element) => element.textContent!.trim()),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);
  return names;
}

const setPosition = (page: Page, position: "bottom-center" | "bottom-right" | "top-center") =>
  page.evaluate((value) => (window as unknown as { tavoraHost: { act(action: unknown): Promise<unknown> } }).tavoraHost.act({ type: "set-toasts", position: value }), position);

/** Where the toast page is in the window and how it stands to the first module panel. */
async function toastsAndPanel(app: Parameters<typeof viewStack>[0]) {
  const { window, views } = await viewStack(app);
  const top = views.at(-1)!;
  const panel = views.find((view) => view.url.startsWith("tavora-module://") && view.visible);
  return { window, top, panel, order: views.map((view) => view.url) };
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("a toast of Tavora's own shows where the user put it, above a panel, and Undo works", async () => {
  const { app, page } = await launch();
  await layOutColumns(page, 1);
  await openModule(page, VANILLA);
  await waitForShown(app, VANILLA);
  await saveLayout(page, "Mapping");
  await setPosition(page, "bottom-center");

  // Nothing of the toast page is in the way while there is no toast.
  const before = await toastsAndPanel(app);
  expect(before.top.url).toMatch(/\/toasts\.html$/);
  expect(before.top.visible).toBe(false);

  await deleteLayout(page, "Mapping");
  const toast = hostToast(page, "undo-toast");
  await expect(toast).toContainText("Layout deleted");

  // It is the topmost view, at the bottom of the window in the middle, over the panel, and not much bigger than the toast.
  await expect.poll(async () => (await toastsAndPanel(app)).top.visible).toBe(true);
  const bottom = await toastsAndPanel(app);
  expect(bottom.top.url).toMatch(/\/toasts\.html$/);
  expect(bottom.panel).toBeDefined();
  expect(intersects(bottom.top.bounds, bottom.panel!.bounds)).toBe(true);
  expect(bottom.top.bounds.y + bottom.top.bounds.height).toBe(bottom.window.height);
  expect(Math.abs(bottom.top.bounds.x + bottom.top.bounds.width / 2 - bottom.window.width / 2)).toBeLessThanOrEqual(1);
  // Shrunk to the toast after a moment: the panel around it takes the mouse.
  await expect.poll(async () => (await toastsAndPanel(app)).top.bounds.width).toBeLessThan(500);
  expect((await toastsAndPanel(app)).top.bounds.height).toBeLessThan(120);
  await expect(toastsPage(page).locator(".tavora-toast")).toBeVisible();

  // The setting moves the toast that is showing, at once.
  await setPosition(page, "bottom-right");
  await expect.poll(async () => {
    const { window, top } = await toastsAndPanel(app);
    return top.bounds.x + top.bounds.width - window.width;
  }).toBe(0);
  await setPosition(page, "top-center");
  await expect.poll(async () => (await toastsAndPanel(app)).top.bounds.y).toBeGreaterThanOrEqual(56);
  const top = await toastsAndPanel(app);
  // Under the header, which drags the window.
  expect(top.top.bounds.y).toBeLessThan(120);
  expect(intersects(top.top.bounds, top.panel!.bounds)).toBe(true);

  // Undo on the toast, which sits over the panel, brings the layout back and the toast goes.
  await toast.getByTestId("undo").click();
  await expect(toast).toHaveCount(0);
  expect(await layoutNames(page)).toEqual(["Mapping"]);
  await expect.poll(async () => (await toastsAndPanel(app)).top.visible).toBe(false);

  // The toast page shows nothing after: the panels have the whole window again.
  expect((await toastsAndPanel(app)).top.visible).toBe(false);
  await app.close();
});

test("a toast stays on top when a panel is added after it", async () => {
  const { app, page } = await launch();
  await layOutColumns(page, 2);
  await openModule(page, VANILLA);
  await waitForShown(app, VANILLA);
  await saveLayout(page, "Mapping");
  await deleteLayout(page, "Mapping");
  await expect(hostToast(page, "undo-toast")).toContainText("Layout deleted");
  // Another panel opens while the toast shows: its view is added above the others, and the toast page is put back over it.
  await openModule(page, VANILLA);
  await expect.poll(async () => (await viewStack(app)).views.filter((view) => view.url.startsWith("tavora-module://")).length).toBe(2);
  expect((await viewStack(app)).views.at(-1)!.url).toMatch(/\/toasts\.html$/);
  await app.close();
});

test("a toast keeps its time while Tavora is hidden", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  await layOutColumns(page, 1);
  await openModule(page, VANILLA);
  await saveLayout(page, "Mapping");
  await deleteLayout(page, "Mapping");
  const toast = hostToast(page, "undo-toast");
  await expect(toast).toContainText("Layout deleted");

  // Minimized: the window says so (a hidden one says it with "hide", which macOS only sends for a tray window).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("/index.html"))!.minimize());
  // Longer than a toast stays (five seconds).
  await page.waitForTimeout(6500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("/index.html"))!.restore());
  await expect(toast).toBeVisible();
  // Shown again, its time runs out as usual.
  await expect(toast).toHaveCount(0, { timeout: 15_000 });
  await app.close();
});

test("a new front toast morphs from the size of the one before it, with no jump", async () => {
  const { app, page } = await launch();
  // Settings > Appearance > Notifications > Try it: "Saving…", then "Note deleted" with Undo, a good deal wider.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  const toasts = toastsPage(page);
  // A frame by frame record of every pill's width (its layout width, which the entrance's scaling does not touch).
  await toasts.evaluate(() => {
    const record: { at: number; widths: Record<string, number> }[] = [];
    (window as unknown as { record: typeof record }).record = record;
    const tick = () => {
      const widths: Record<string, number> = {};
      for (const pill of Array.from(document.querySelectorAll<HTMLElement>('[data-slot="toast"]'))) widths[pill.querySelector(".tavora-toast-title")?.textContent ?? "?"] = pill.offsetWidth;
      record.push({ at: performance.now(), widths });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByTestId("try-toasts").click();
  await expect(toasts.locator(".tavora-toast-title", { hasText: "Note deleted" })).toBeVisible();
  await page.waitForTimeout(900);
  const record = await toasts.evaluate(() => (window as unknown as { record: { at: number; widths: Record<string, number> }[] }).record);
  const saving = record.map((frame) => frame.widths["Saving…"]).filter((width): width is number => width !== undefined);
  const deleted = record.map((frame) => frame.widths["Note deleted"]).filter((width): width is number => width !== undefined);
  const first = deleted[0]!;
  const last = deleted.at(-1)!;
  // It comes in as wide as the one in front, and ends at its own, wider width.
  expect(Math.abs(first - saving[0]!)).toBeLessThanOrEqual(2);
  expect(last).toBeGreaterThan(first + 40);
  // Between them it passes through several widths, frame by frame: no single frame jumps most of the way.
  const between = new Set(deleted.filter((width) => width > first + 1 && width < last - 1));
  expect(between.size).toBeGreaterThanOrEqual(3);
  const biggestStep = Math.max(...deleted.slice(1).map((width, index) => Math.abs(width - deleted[index]!)));
  expect(biggestStep).toBeLessThan((last - first) * 0.75);
  // The one behind never snaps to a width the new toast did not have yet.
  await app.close();
});
