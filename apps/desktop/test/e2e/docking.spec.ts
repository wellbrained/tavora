// Docking: splits and tabs, the layout saved per game, and named layouts.
import { expect, test, type Page } from "@playwright/test";
import {
  expectModuleText,
  inModule,
  launch,
  openModule,
  panels,
  RAIL_WIDTH,
  REACT,
  setContentSize,
  typeInModule,
  VANILLA,
  VUE,
  waitForShown,
} from "./harness";

const groups = (page: Page) => page.locator(".dv-groupview");

test("outer columns fold together, suspend their panels, and survive a restart", async ({}, testInfo) => {
  const { app, page, userData } = await launch();
  await page.getByTestId("empty-template-main-stacked").click();
  for (const moduleId of [VANILLA, REACT, VUE]) await openModule(page, moduleId);
  await expect(groups(page)).toHaveCount(3);
  const before = (await panels(page, REACT).boundingBox())!;
  await page.screenshot({ path: testInfo.outputPath("stacked-headers.png") });
  await page.getByTestId("hide-right-column").first().click();
  await expect(page.getByTestId("show-right-column")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("collapsed-column.png") });
  await expect(panels(page, REACT)).toBeHidden();
  await expect(panels(page, VUE)).toBeHidden();
  await expectModuleText(app, REACT, "lifecycle", "suspended");
  await expectModuleText(app, VUE, "lifecycle", "suspended");
  await expect(page.getByTestId("hide-left-column")).toHaveCount(0);
  await page.waitForTimeout(500);
  await app.close();

  const again = await launch(userData);
  await expect(again.page.getByTestId("show-right-column")).toBeVisible();
  await expect(panels(again.page, REACT)).toBeHidden();
  await again.page.getByTestId("show-right-column").focus();
  await again.page.keyboard.press("Enter");
  await expect(panels(again.page, REACT)).toBeVisible();
  await expect(panels(again.page, VUE)).toBeVisible();
  await expectModuleText(again.app, REACT, "lifecycle", "active");
  const after = (await panels(again.page, REACT).boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
  await again.page.getByTestId("hide-left-column").click();
  await expect(again.page.getByTestId("show-left-column")).toBeVisible();
  await expect(panels(again.page, VANILLA)).toBeHidden();
  await again.page.getByTestId("show-left-column").click();
  await expect(panels(again.page, VANILLA)).toBeVisible();
  await again.app.close();
});

test("both outer columns can fold while the middle stays open", async () => {
  const { app, page } = await launch();
  await page.getByTestId("empty-template-main-stacked").click();
  await page.getByTestId("layouts").click();
  await page.getByTestId("layout-grid-3x1").click();
  for (const moduleId of [VANILLA, REACT, VUE]) await openModule(page, moduleId);
  await page.getByTestId("hide-left-column").click();
  await page.getByTestId("hide-right-column").click();
  await expect(page.getByTestId("show-left-column")).toBeVisible();
  await expect(page.getByTestId("show-right-column")).toBeVisible();
  await expect(panels(page, REACT)).toBeVisible();
  await page.getByTestId("show-left-column").click();
  await page.getByTestId("show-right-column").click();
  for (const moduleId of [VANILLA, REACT, VUE]) await expect(panels(page, moduleId)).toBeVisible();
  await page.getByTestId("hide-right-column").click();
  await panelMenu(page, VANILLA, "panel-close");
  await panelMenu(page, REACT, "panel-close");
  await expect(panels(page, VUE)).toBeVisible();
  await expect(page.getByTestId("show-right-column")).toHaveCount(0);
  await app.close();
});

/** Opens the ⋯ menu of the group showing a module's panel and picks an item. */
async function panelMenu(page: Page, moduleId: string, item: string) {
  await panels(page, moduleId).click({ button: "right" });
  await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
}

async function answerPrompt(page: Page, value: string) {
  await page.getByTestId("prompt-input").fill(value);
  await page.getByTestId("prompt-submit").click();
  await expect(page.getByTestId("prompt")).toHaveCount(0);
}

/** Picks an item from a saved layout's submenu. */
async function layoutMenu(page: Page, name: string, item: string) {
  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"]').getByText(name, { exact: true }).click();
  await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
}

test("panels open side by side, and as tabs once there is no room", async () => {
  const { app, page } = await launch();
  await setContentSize(app, RAIL_WIDTH + 1000, 500);
  // minWidth is 320, so three columns fit in 1000px and a fourth does not.
  // minHeight is 240, so there is no room to split one either.
  for (let i = 0; i < 3; i++) await openModule(page, VANILLA);
  await expect(groups(page)).toHaveCount(3);
  // The fourth becomes a tab in the focused group: the third one, once its tab is clicked.
  await panels(page).nth(2).click();
  await openModule(page, VANILLA);
  await expect(panels(page)).toHaveCount(4);
  await expect(groups(page)).toHaveCount(3);
  await expect(groups(page).nth(2).locator("[data-panel-tab]")).toHaveCount(2);
  for (const index of [0, 1, 2, 3]) await expectModuleText(app, VANILLA, "status", "Connected", index);

  // The newest panel is the selected tab; the one behind it is hidden and paused.
  await expectModuleText(app, VANILLA, "lifecycle", "suspended", 2);
  await expectModuleText(app, VANILLA, "lifecycle", "active", 3);
  await panels(page, VANILLA).nth(2).click();
  await expectModuleText(app, VANILLA, "lifecycle", "active", 2);
  await expectModuleText(app, VANILLA, "lifecycle", "suspended", 3);
  await app.close();
});

test("panels are moved, split and maximized from their menu, and the layout is kept", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await expect(groups(page)).toHaveCount(2);

  // React joins the vanilla panel's group as a second tab.
  await panelMenu(page, REACT, "panel-move-previous");
  await expect(groups(page)).toHaveCount(1);
  await expectModuleText(app, VANILLA, "lifecycle", "suspended");

  // Split down puts it below, in a group of its own.
  await panelMenu(page, REACT, "panel-split-down");
  await expect(groups(page)).toHaveCount(2);
  const top = (await panels(page, VANILLA).boundingBox())!;
  const bottom = (await panels(page, REACT).boundingBox())!;
  expect(bottom.y).toBeGreaterThan(top.y + 200);
  expect(bottom.x).toBe(top.x);
  await expectModuleText(app, VANILLA, "lifecycle", "active");
  // The module sees the size of its half: 900 high, minus the 56px header, the
  // 8px margin below the dock and the 8px gap, then its 36px tab bar and 1px card borders.
  const height = Number(await inModule<number>(app, REACT, "innerHeight"));
  expect(Math.abs(height - ((900 - 56 - 8 - 8) / 2 - 36 - 2))).toBeLessThanOrEqual(1);

  // Maximize hides the other group and pauses its module.
  await panelMenu(page, REACT, "panel-maximize");
  await expectModuleText(app, VANILLA, "lifecycle", "suspended");
  await panelMenu(page, REACT, "panel-restore");
  await expectModuleText(app, VANILLA, "lifecycle", "active");
  await page.waitForTimeout(500); // the layout is saved once it has been still briefly
  await app.close();

  // The arrangement comes back after a restart.
  const again = await launch(userData);
  await expect(groups(again.page)).toHaveCount(2);
  const topAgain = (await panels(again.page, VANILLA).boundingBox())!;
  const bottomAgain = (await panels(again.page, REACT).boundingBox())!;
  expect(bottomAgain.y).toBeCloseTo(bottom.y, -1);
  expect(topAgain.x).toBe(bottomAgain.x);
  await again.app.close();
});

test("a module maximizes its own panel after a key press, and it stays maximized after a restart", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await expect(groups(page)).toHaveCount(2);
  await expectModuleText(app, VANILLA, "maximized", "no");

  // Without a real click or key press the panel stays where it is.
  await inModule(app, VANILLA, `document.querySelector('[data-testid="toggle-maximized"]').click()`);
  await expectModuleText(app, VANILLA, "maximized", "PERMISSION_DENIED");
  await expectModuleText(app, REACT, "lifecycle", "active");

  await inModule(app, VANILLA, `document.querySelector('[data-testid="toggle-maximized"]').focus()`);
  await typeInModule(app, VANILLA, "\n");
  await expectModuleText(app, VANILLA, "maximized", "yes");
  await expectModuleText(app, REACT, "lifecycle", "suspended");
  await page.waitForTimeout(500); // the layout is saved once it has been still briefly
  await app.close();

  const again = await launch(userData);
  await expectModuleText(again.app, VANILLA, "maximized", "yes");
  await expectModuleText(again.app, REACT, "lifecycle", "suspended");
  // Restore in the panel's menu tells the module too.
  await panelMenu(again.page, VANILLA, "panel-restore");
  await expectModuleText(again.app, VANILLA, "maximized", "no");
  await expectModuleText(again.app, REACT, "lifecycle", "active");
  // Maximize from the menu, then put back by the module, which needs no key press.
  await panelMenu(again.page, VANILLA, "panel-maximize");
  await expectModuleText(again.app, VANILLA, "maximized", "yes");
  await inModule(again.app, VANILLA, `document.querySelector('[data-testid="toggle-maximized"]').click()`);
  await expectModuleText(again.app, VANILLA, "maximized", "no");
  await expectModuleText(again.app, REACT, "lifecycle", "active");
  await again.app.close();
});

test("a module is removed from one workspace from its panel menu, leaving empty slots", async () => {
  const { app, page } = await launch();
  await setContentSize(app, RAIL_WIDTH + 1000, 500);
  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await openModule(page, VANILLA);
  await expect(groups(page)).toHaveCount(3);
  const react = (await panels(page, REACT).boundingBox())!;

  // Both vanilla panels go; their columns stay as empty slots, so React keeps its place.
  await panels(page, VANILLA).first().click({ button: "right" });
  await page.locator('[role="menu"][data-state="open"] [data-testid="panel-remove-module"]').click();
  await expect(panels(page, VANILLA)).toHaveCount(0);
  await expect(page.locator("[data-testid^='empty-slot-']")).toHaveCount(2);
  await expect(groups(page)).toHaveCount(3);
  expect((await panels(page, REACT).boundingBox())!.x).toBeCloseTo(react.x, -1);
  await app.close();
});

test("a tab dragged to the edge of another group splits it", async () => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await panelMenu(page, REACT, "panel-move-previous");
  await expect(groups(page)).toHaveCount(1);

  // Playwright's mouse does not drive HTML drag and drop in Electron, so
  // the events are sent as the browser would send them.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const tab = page.locator(".dv-tab", { has: panels(page, REACT) });
  const content = page.locator(".dv-content-container").first();
  const box = (await content.boundingBox())!;
  const at = { dataTransfer, clientX: box.x + box.width - 10, clientY: box.y + box.height / 2 };
  await tab.dispatchEvent("dragstart", { dataTransfer });
  // Module views are hidden during the drag, so the drop zones can be seen and used.
  await expect(page.locator("[data-testid^='panel-content-'] img").first()).toBeAttached();
  // The drop guide shows over the group; aiming at its middle cell means a tab, at its right cell a split.
  const centre = { dataTransfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await content.dispatchEvent("dragenter", centre);
  await content.dispatchEvent("dragover", centre);
  await expect(page.getByTestId("drop-guide")).toHaveAttribute("data-position", "center");
  await content.dispatchEvent("dragover", { ...centre, clientX: centre.clientX + 46 });
  await expect(page.getByTestId("drop-guide")).toHaveAttribute("data-position", "right");
  await content.dispatchEvent("dragover", at);
  await content.dispatchEvent("drop", at);
  await tab.dispatchEvent("dragend", { dataTransfer });
  await expect(page.getByTestId("drop-guide")).toHaveCount(0);
  await expect(groups(page)).toHaveCount(2);
  const left = (await panels(page, VANILLA).boundingBox())!;
  const right = (await panels(page, REACT).boundingBox())!;
  expect(right.x).toBeGreaterThan(left.x + 300);
  await app.close();
});

test("dragging a column beside another in its row moves it there and shows a bar, keeping widths", async () => {
  const { app, page } = await launch();
  await setContentSize(app, RAIL_WIDTH + 1500, 800);
  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await openModule(page, VUE);
  await expect(groups(page)).toHaveCount(3);
  const column = (id: string) => groups(page).filter({ has: panels(page, id) });
  const width = (await column(VANILLA).boundingBox())!.width;

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const tab = page.locator(".dv-tab", { has: panels(page, VANILLA) });
  const content = column(VUE).locator(".dv-content-container");
  const box = (await content.boundingBox())!;
  // The guide's right cell.
  const right = { dataTransfer, clientX: box.x + box.width / 2 + 46, clientY: box.y + box.height / 2 };
  await tab.dispatchEvent("dragstart", { dataTransfer });
  await content.dispatchEvent("dragenter", right);
  await content.dispatchEvent("dragover", right);
  await expect(page.locator("[data-drop-line='right']")).toHaveCount(1);
  await content.dispatchEvent("drop", right);
  await tab.dispatchEvent("dragend", { dataTransfer });
  await expect(page.locator("[data-drop-line]")).toHaveCount(0);

  // Vanilla is now the last column, and every column kept its width.
  await expect(groups(page)).toHaveCount(3);
  const after = await Promise.all([REACT, VUE, VANILLA].map(async (id) => (await column(id).boundingBox())!));
  expect(after[0]!.x).toBeLessThan(after[1]!.x);
  expect(after[1]!.x).toBeLessThan(after[2]!.x);
  expect(Math.abs(after[2]!.width - width)).toBeLessThanOrEqual(10);
  await app.close();
});

test("module views are replaced by still images while a menu is open", async () => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "status", "Connected");
  // A page is only shown once it has settled; before that there is nothing to replace with an image.
  await waitForShown(app, VANILLA);
  const image = page.locator("[data-testid^='panel-content-'] img");
  await expect(image).toHaveCount(0);
  await page.getByTestId("layouts").click();
  await expect(image).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(image).toHaveCount(0);
  await app.close();
});

test("named layouts are saved, applied, renamed and deleted", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await expectModuleText(app, VANILLA, "status", "Connected");
  await inModule(app, VANILLA, `document.querySelector('[data-testid="increment"]').click()`);
  await expectModuleText(app, VANILLA, "count", "1");
  const vanillaId = await panels(page, VANILLA).getAttribute("data-testid");

  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]').click();
  await answerPrompt(page, "Builds");

  // Change the workspace: React goes, Vue comes.
  await panels(page, REACT).getByTestId("close").click();
  await openModule(page, VUE);
  await expect(panels(page, VUE)).toHaveCount(1);

  await layoutMenu(page, "Builds", "layout-apply");
  await expect(panels(page, VUE)).toHaveCount(0);
  await expect(panels(page, REACT)).toHaveCount(1);
  await expect(groups(page)).toHaveCount(2);
  // The vanilla panel was kept as it was; module data is never touched.
  expect(await panels(page, VANILLA).getAttribute("data-testid")).toBe(vanillaId);
  await expectModuleText(app, VANILLA, "count", "1");

  await layoutMenu(page, "Builds", "layout-rename");
  await answerPrompt(page, "Mapping");
  await app.close();

  const again = await launch(userData);
  await layoutMenu(again.page, "Mapping", "layout-delete");
  await again.page.getByTestId("confirm-submit").click();
  await again.page.getByTestId("layouts").click();
  await expect(again.page.locator('[role="menu"][data-state="open"]').getByText("Mapping")).toHaveCount(0);
  await again.page.keyboard.press("Escape");
  // Deleting a layout leaves the open panels alone.
  await expect(panels(again.page)).toHaveCount(2);
  await again.app.close();
});

test("a template lays out empty slots that modules fill, and is kept", async () => {
  const { app, page, userData } = await launch();
  const slots = page.locator("[data-testid^='empty-slot-']");
  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"] [data-testid="layout-grid-3x1"]').click();
  await expect(groups(page)).toHaveCount(3);
  await expect(slots).toHaveCount(3);
  await expect(page.getByTestId("empty-workspace")).toHaveCount(0);

  // A slot's own button fills that slot.
  await slots.nth(1).getByTestId("slot-add-module").click();
  await page.getByTestId(`open-${VANILLA}`).click();
  await expect(groups(page).nth(1).locator(`[data-panel-tab][data-module-id="${VANILLA}"]`)).toHaveCount(1);
  await expect(slots).toHaveCount(2);
  // Add module in the toolbar fills the next empty slot instead of splitting.
  await openModule(page, REACT);
  await expect(groups(page)).toHaveCount(3);
  await expect(slots).toHaveCount(1);
  await expectModuleText(app, VANILLA, "status", "Connected");

  await slots.first().getByTestId("slot-remove").click();
  await expect(slots).toHaveCount(0);
  await expect(groups(page)).toHaveCount(2);
  await page.waitForTimeout(500); // the layout is saved once it has been still briefly
  await app.close();

  // Applying a template to open panels fills its first slots with them, and empty slots are kept.
  const again = await launch(userData);
  await expect(groups(again.page)).toHaveCount(2);
  await again.page.getByTestId("layouts").click();
  await again.page.locator('[role="menu"][data-state="open"] [data-testid="layout-grid-2x2"]').click();
  await expect(groups(again.page)).toHaveCount(4);
  await expect(panels(again.page)).toHaveCount(2);
  await expect(again.page.locator("[data-testid^='empty-slot-']")).toHaveCount(2);
  await again.page.waitForTimeout(500);
  await again.app.close();

  const third = await launch(userData);
  await expect(groups(third.page)).toHaveCount(4);
  await expect(third.page.locator("[data-testid^='empty-slot-']")).toHaveCount(2);
  await third.app.close();
});

test("the templates submenu opens level with its entry and stays open on the way to it", async () => {
  const { app, page } = await launch();
  await page.getByTestId("layouts").click();
  const entry = page.getByTestId("layout-templates");
  await entry.hover();
  const target = page.getByTestId("layout-template-two-bottom");
  await expect(target).toBeVisible();
  const from = (await entry.boundingBox())!;
  const submenu = (await page.locator('[role="group"][aria-label="Templates"]').boundingBox())!;
  expect(Math.abs(submenu.y - from.y)).toBeLessThanOrEqual(2);

  // An unhurried diagonal move from the entry to the farthest template, across the grid picker below the
  // entry, keeps the submenu open.
  const to = (await target.boundingBox())!;
  const start = { x: from.x + from.width * 0.8, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  await page.mouse.move(start.x, start.y);
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(start.x + ((end.x - start.x) * step) / 20, start.y + ((end.y - start.y) * step) / 20);
    await page.waitForTimeout(50);
  }
  await expect(target).toBeVisible();
  await target.click();
  await expect(groups(page)).toHaveCount(3);
  await expect(page.locator("[data-testid^='empty-slot-']")).toHaveCount(3);
  await app.close();
});
