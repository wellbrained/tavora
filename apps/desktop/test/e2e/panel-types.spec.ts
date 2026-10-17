// Named panel types (the decision log, named panels rows of 2026-10-17): the
// module library lists a module's panel types, each opens its own page and
// tells it which type it is, and a panel whose type an update removed keeps
// its slot until the player picks another type. Each panel shows content of
// its own, kept across restarts and named on its tab's hover text.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectModuleText, inModule, launch, newUserData, panels } from "./harness";

const PANELS = "local.example.panels-module";

async function addPanel(page: import("@playwright/test").Page, type: string) {
  await page.getByTestId("add-module").click();
  await expect(page.getByTestId(`panel-types-${PANELS}`)).toBeVisible();
  await page.getByTestId(`open-${PANELS}-${type}`).click();
  await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);
}

test("each panel type opens its own page, named on its tab", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);

  await addPanel(page, "planner");
  await expect(panels(page, PANELS)).toHaveCount(1);
  await expect(page.locator(`[data-panel-tab][data-panel-type="planner"]`)).toContainText("Build planner");
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
  for (const record of saved.games.poe2.instances) if (record.panelType === "inventory") record.panelType = "removed";
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

const ICE_SHOT = "0.5 Ice Shot Deadeye Leveling Guide";

/** Picks a build in a panel's toolbar, as the player would. */
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
  await expectModuleText(app, PANELS, "launch", "add: the player just added this panel, so it picked the build used last");
  await expect(tabs.nth(0)).toHaveAttribute("data-content", ICE_SHOT);
  await expect(tabs.nth(0)).toHaveAttribute("title", `Build planner · Panel Types Example\n${ICE_SHOT}`);
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
