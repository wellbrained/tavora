// Too many tabs (Settings > Appearance): the tabs that don't fit a panel's tab row are in a list (the kit's menu, so
// the module views freeze under it instead of covering it), or two arrows step through them. Ctrl+Tab and
// Ctrl+Shift+Tab step through the tabs of the panel you work in.
import { expect, test, type Page } from "@playwright/test";
import { launch, layOutColumns, NOTES, openModule, PDF_VIEWER, PLAYGROUND, REACT, TODOS, VANILLA, VUE, WHITEBOARD } from "./harness";

/** The panel id of the open tab in the panel you work in. */
const activeTab = (page: Page) =>
  page.locator(".dv-groupview.dv-active-group .dv-tab.dv-active-tab [data-panel-tab]").getAttribute("data-testid");

/** Ids of the tabs in the panel you work in, in order. */
const tabsOfActive = (page: Page) =>
  page.locator(".dv-groupview.dv-active-group .dv-tab [data-panel-tab]").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-testid")));

/** Whether a tab lies entirely inside its row. */
const inView = (page: Page, testid: string) =>
  page.getByTestId(testid).evaluate((tab) => {
    const row = tab.closest(".dv-tabs-container")!.getBoundingClientRect();
    const box = tab.closest(".dv-tab")!.getBoundingClientRect();
    return box.left >= row.left - 0.5 && box.right <= row.right + 0.5;
  });

test("tabs that don't fit are in a list or behind arrows, and Ctrl+Tab steps through them", async () => {
  const { app, page } = await launch();
  await layOutColumns(page, 3);
  for (const id of [NOTES, TODOS, PLAYGROUND, WHITEBOARD, PDF_VIEWER, VANILLA, REACT, VUE]) await openModule(page, id);
  const group = page.locator(".dv-groupview.dv-active-group");
  await expect(group.locator("[data-panel-tab]")).toHaveCount(6);

  // Tabs keep their width, so some scroll out of the row; Dockview's own list stays hidden, ours counts them.
  const list = group.getByTestId("hidden-tabs");
  await expect(list).toBeVisible();
  await expect(page.locator(".dv-tabs-overflow-dropdown-root:visible")).toHaveCount(0);
  const tabs = await tabsOfActive(page);
  const widths = await group.locator(".dv-tab").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  for (const width of widths) expect(width).toBeGreaterThan(60);
  // The open tab stays in the row, also once the row got narrower after it opened.
  await expect.poll(async () => inView(page, (await activeTab(page))!)).toBe(true);

  // The list names the hidden tabs; picking one opens it and brings it into the row.
  const hidden: string[] = [];
  for (const id of tabs) if (!(await inView(page, id!))) hidden.push(id!);
  expect(hidden.length).toBeGreaterThan(0);
  expect(hidden.length).toBeLessThan(tabs.length);
  await list.click();
  const menu = page.locator('[role="menu"][data-state="open"]');
  await expect(menu.locator("[data-testid^='hidden-tab-']")).toHaveCount(hidden.length);
  const pick = hidden[0]!.slice("panel-".length);
  await menu.getByTestId(`hidden-tab-${pick}`).click();
  await expect.poll(() => activeTab(page)).toBe(`panel-${pick}`);
  await expect.poll(() => inView(page, `panel-${pick}`)).toBe(true);

  // Ctrl+Tab and Ctrl+Shift+Tab: the next and the previous tab, round at the ends.
  const at = async () => tabs.indexOf(await activeTab(page));
  const start = await at();
  await page.keyboard.press("Control+Tab");
  await expect.poll(at).toBe((start + 1) % tabs.length);
  await page.keyboard.press("Control+Shift+Tab");
  await expect.poll(at).toBe(start);

  // Arrows instead of the list: they step to the tab before and after the open one.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("tab-overflow-arrows").click();
  await page.getByTestId("settings-close").click();
  await expect(group.getByTestId("hidden-tabs")).toHaveCount(0);
  await group.locator("[data-panel-tab]").first().click();
  await expect(group.getByTestId("previous-tab")).toBeDisabled();
  await group.getByTestId("next-tab").click();
  await expect.poll(at).toBe(1);
  await group.getByTestId("previous-tab").click();
  await expect.poll(at).toBe(0);
  await app.close();
});
