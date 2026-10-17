// Named panel types (the decision log, named panels rows of 2026-10-17): the
// module library lists a module's panel types, each opens its own page and
// tells it which type it is, and a panel whose type an update removed keeps
// its slot until the player picks another type.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectModuleText, launch, newUserData, panels } from "./harness";

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
  await expect(page.locator(`[data-panel-tab][data-panel-type="planner"]`)).toHaveAttribute("title", "Build planner · Panel Types Example");
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
