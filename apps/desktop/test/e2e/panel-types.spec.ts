// Named panel types (the decision log, named panels rows of 2026-10-17): the
// module library lists a module's panel types, each opens its own page and
// tells it which type it is, and a panel whose type an update removed keeps
// its slot until the user picks another type. Each panel shows content of
// its own, kept across restarts and named on its tab's hover text, and can
// open the module's other panels on it.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectModuleText, hintOf, inModule, launch, newUserData, panels, typeInModule } from "./harness";

const PANELS = "local.example.panels-module";

async function addPanel(page: import("@playwright/test").Page, type: string) {
  await page.getByTestId("add-module").click();
  await page.getByTestId(`panel-menu-toggle-${PANELS}`).click();
  await expect(page.getByTestId(`panel-types-${PANELS}`)).toBeVisible();
  await page.getByTestId(`open-${PANELS}-${type}`).click();
  // The library stays open for the module's other panels.
  await expect(page.getByTestId("add-module-dialog")).toBeVisible();
  // Escape closes the panel list first, then the library.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`panel-types-${PANELS}`)).toHaveCount(0);
  await expect(page.getByTestId("add-module-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);
}

test("each panel type opens its own page, named on its tab", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);

  await addPanel(page, "planner");
  await expect(panels(page, PANELS)).toHaveCount(1);
  await expect(page.locator(`[data-panel-tab][data-panel-type="planner"]`)).toContainText("Build planner");
  await expect.poll(() => hintOf(page.locator(`[data-panel-tab][data-panel-type="planner"]`))).toBe("Build planner · Panel Types Example");
  await expectModuleText(app, PANELS, "panel-type", "Build planner");
  await expectModuleText(app, PANELS, "page", "Page: planner.html");

  // Another type shares the module's own page and learns its type from Tavora.
  await addPanel(page, "inventory");
  await expect(page.locator(`[data-panel-tab][data-panel-type="inventory"]`)).toContainText("Inventory");
  await expectModuleText(app, PANELS, "panel-type", "Inventory", 1);
  await expectModuleText(app, PANELS, "page", "Page: index.html", 1);
  await app.close();

  // An update that drops a type leaves its panel in place, saying so, until another type is picked.
  const file = path.join(userData, "workspace.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  for (const record of saved.workspaces.poe2.instances) if (record.panelType === "inventory") record.panelType = "removed";
  await writeFile(file, JSON.stringify(saved));
  const again = await launch(userData);
  const gone = again.page.locator('[data-testid^="panel-type-gone-"]');
  await expect(gone).toBeVisible();
  await expect(again.page.locator('[data-panel-tab][data-status="unavailable"]')).toHaveCount(1);
  await gone.getByTestId("choose-panel-type-overview").click();
  await expect(gone).toHaveCount(0);
  await expect(again.page.locator(`[data-panel-tab][data-panel-type="overview"]`)).toContainText("Overview");
  await expectModuleText(again.app, PANELS, "panel-type", "Overview", 1);
  await again.app.close();
});

test("the library stays open to add several panels, and Add all opens one of each", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  await page.getByTestId("add-module").click();
  await expect(page.getByTestId(`panel-count-${PANELS}`)).toHaveText("3 panels");
  await page.getByTestId(`panel-count-${PANELS}`).click();
  await page.getByTestId(`open-${PANELS}-planner`).click();
  await page.getByTestId(`open-${PANELS}-planner`).click();
  await expect(panels(page, PANELS)).toHaveCount(2);
  await expect(page.getByTestId("add-module-dialog")).toBeVisible();
  await expect(page.getByTestId(`in-workspace-${PANELS}`)).toHaveText("2 open");
  // A click outside the card closes the list, which drops over the card below.
  await page.getByTestId("module-view-title").click();
  await expect(page.getByTestId(`panel-types-${PANELS}`)).toHaveCount(0);
  await page.getByTestId(`open-all-${PANELS}`).click();
  await expect(panels(page, PANELS)).toHaveCount(5);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);
  for (const type of ["overview", "inventory"]) await expect(page.locator(`[data-panel-tab][data-panel-type="${type}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-panel-tab][data-panel-type="planner"]`)).toHaveCount(3);
  await app.close();
});

const ICE_SHOT = "0.5 Ice Shot Deadeye Leveling Guide";

/** Picks a build in a panel's toolbar, as the user would. */
async function pickBuild(app: import("@playwright/test").ElectronApplication, build: string, index: number) {
  await inModule(
    app,
    PANELS,
    `(() => { const select = document.querySelector('[data-testid="content-select"]'); select.value = ${JSON.stringify(build)}; select.dispatchEvent(new Event("change")); })()`,
    index,
  );
}

test("each panel keeps the content it shows, and its tab names it on hover", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  const tabs = page.locator('[data-panel-tab][data-panel-type="planner"]');

  // A fresh panel is told it was added, and picks the first build.
  await addPanel(page, "planner");
  await expectModuleText(app, PANELS, "launch", "add: the user just added this panel, so it picked the build used last");
  await expect(tabs.nth(0)).toHaveAttribute("data-content", ICE_SHOT);
  await expect.poll(() => hintOf(tabs.nth(0))).toBe(`Build planner · Panel Types Example\n${ICE_SHOT}`);
  await pickBuild(app, "lightning-arrow", 0);
  await expect(tabs.nth(0)).toHaveAttribute("data-content", "Lightning Arrow Invoker");

  // A copy of the same type starts on the build used last, then goes its own way.
  await addPanel(page, "planner");
  await expect(tabs.nth(1)).toHaveAttribute("data-content", "Lightning Arrow Invoker");
  await pickBuild(app, "minion-witch", 1);
  await expect(tabs.nth(1)).toHaveAttribute("data-content", "Minion Witch for maps");
  await expect(tabs.nth(0)).toHaveAttribute("data-content", "Lightning Arrow Invoker");
  await app.close();

  // After a restart each panel is told what it showed, and shows it again.
  const again = await launch(userData);
  const after = again.page.locator('[data-panel-tab][data-panel-type="planner"]');
  await expect(after.nth(0)).toHaveAttribute("data-content", "Lightning Arrow Invoker");
  await expect(after.nth(1)).toHaveAttribute("data-content", "Minion Witch for maps");
  await expectModuleText(again.app, PANELS, "launch", 'restore: it was open before and showed "Lightning Arrow Invoker"', 0);
  await expectModuleText(again.app, PANELS, "launch", 'restore: it was open before and showed "Minion Witch for maps"', 1);

  // Deleting a panel's build leaves it open with a note; the other panel keeps its own.
  await inModule(again.app, PANELS, `document.querySelector('[data-testid="delete-content"]').click()`, 1);
  await expect.poll(() => inModule(again.app, PANELS, `document.querySelector('[data-testid="content-gone"]').hidden`, 1)).toBe(false);
  await expect(after.nth(1)).not.toHaveAttribute("data-content");
  await expect(after.nth(0)).toHaveAttribute("data-content", "Lightning Arrow Invoker");
  await again.app.close();
});

/** Presses a button in a panel with a real key press, which panels.open needs. */
async function press(app: import("@playwright/test").ElectronApplication, testId: string, index: number) {
  await inModule(app, PANELS, `document.querySelector('[data-testid="${testId}"]').focus()`, index);
  await typeInModule(app, PANELS, "\n", index);
}

test("a panel opens the module's other panels on its content, switching the one used last", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  const planners = page.locator('[data-panel-tab][data-panel-type="planner"]');
  const result = (index: number) => inModule<string>(app, PANELS, `document.querySelector('[data-testid="open-result"]').textContent`, index);

  await addPanel(page, "overview");
  await addPanel(page, "planner");
  await expect(planners.nth(0)).toHaveAttribute("data-content", ICE_SHOT);

  // The planner shows another build, so it is asked to switch, and does.
  await pickBuild(app, "lightning-arrow", 0);
  await press(app, "open-planner", 0);
  await expect.poll(() => result(0)).toBe("switched");
  await expect(planners.nth(0)).toHaveAttribute("data-content", "Lightning Arrow Invoker");
  await expect(planners).toHaveCount(1);

  // Already showing it: brought forward, nothing switches.
  await press(app, "open-planner", 0);
  await expect.poll(() => result(0)).toBe("shown");

  // Without a real click or key press nothing happens.
  await pickBuild(app, "ice-shot", 0);
  await inModule(app, PANELS, `document.querySelector('[data-testid="open-planner"]').click()`, 0);
  await page.waitForTimeout(500);
  await expect(planners.nth(0)).toHaveAttribute("data-content", "Lightning Arrow Invoker");

  // A planner that cannot switch keeps its build, and the user may open the build in a new panel.
  await inModule(app, PANELS, `document.querySelector('[data-testid="refuse-switch"]').click()`, 1);
  await pickBuild(app, "minion-witch", 0);
  await press(app, "open-planner", 0);
  await expect.poll(() => result(0)).toBe("failed");
  await expect(page.getByTestId("navigation-choice")).toBeVisible();
  await expect(page.getByTestId("navigation-choice-content")).toHaveText("Minion Witch for maps");
  await expect(planners.nth(0)).toHaveAttribute("data-content", "Lightning Arrow Invoker");
  await page.getByTestId("navigation-choice-new-panel").click();
  await expect(planners).toHaveCount(2);
  await expect(planners.nth(1)).toHaveAttribute("data-content", "Minion Witch for maps");
  await expectModuleText(app, PANELS, "launch", 'open: another panel opened it on "Minion Witch for maps"', 2);

  // No panel of that type yet: a new one opens on the build.
  await press(app, "open-inventory", 0);
  await expect.poll(() => result(0)).toBe("opened");
  await expect(page.locator('[data-panel-tab][data-panel-type="inventory"]')).toHaveAttribute("data-content", "Minion Witch for maps");
  await app.close();
});

test("the modules menu adds the panel types not open yet and brings open ones to the front", async () => {
  const { app, page } = await launch(await newUserData());
  const tab = (type: string) => page.locator(`[data-panel-tab][data-panel-type="${type}"]`);
  const front = (type: string) => page.locator(`.dv-tab.dv-active-tab [data-panel-type="${type}"]`);
  // Nothing in the game yet: only Add module.
  await expect(page.getByTestId("modules-in-game")).toHaveCount(0);
  await addPanel(page, "planner");

  // The toolbar's ▾ lists the module with its panel types; the open one is checked.
  await page.getByTestId("modules-in-game").click();
  await expect(page.getByTestId(`in-workspace-heading-${PANELS}`)).toHaveText("Panel Types Example");
  await expect(page.getByTestId(`in-workspace-${PANELS}-planner`)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId(`in-workspace-${PANELS}-inventory`)).toHaveAttribute("aria-checked", "false");
  await page.getByTestId(`in-workspace-${PANELS}-inventory`).click();
  await expect(tab("inventory")).toHaveCount(1);
  await expect(panels(page, PANELS)).toHaveCount(2);

  // The same list on a tab's right-click: picking an open type brings it to the front, it never opens twice.
  await tab("inventory").click({ button: "right" });
  await page.getByTestId("panel-move-next").click();
  await expect(front("inventory")).toHaveCount(1);
  await expect(front("planner")).toHaveCount(0);
  await tab("inventory").click({ button: "right" });
  await page.getByTestId("panel-in-game").click();
  await page.getByTestId(`in-workspace-${PANELS}-planner`).click();
  await expect(front("planner")).toHaveCount(1);
  await expect(panels(page, PANELS)).toHaveCount(2);

  // Ctrl+K has an entry per panel type, with the same rule.
  await page.keyboard.press("Control+K");
  await page.getByTestId("search-input").fill("overview");
  await page.getByTestId(`search-panel-${PANELS}-overview`).click();
  await expect(tab("overview")).toHaveCount(1);
  await page.keyboard.press("Control+K");
  await page.getByTestId("search-input").fill("inventory");
  await expect(page.getByTestId(`search-panel-${PANELS}-inventory`)).toContainText("Open Inventory · Panel Types Example");
  await page.getByTestId(`search-panel-${PANELS}-inventory`).click();
  await expect(front("inventory")).toHaveCount(1);
  await expect(panels(page, PANELS)).toHaveCount(3);
  await app.close();
});
