import { expect, test } from "@playwright/test";
import {
  clickInModule,
  expectModuleText,
  inModule,
  launch,
  openGame,
  openModule,
  panels,
  RAIL_WIDTH,
  REACT,
  setContentSize,
  VANILLA,
} from "./harness";

test("a new game starts with an empty workspace", async () => {
  const { app, page } = await launch();
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  await expect(panels(page)).toHaveCount(0);
  // Choosing a layout comes first: the card has no Add module button of its own.
  await expect(page.getByTestId("empty-add-module")).toHaveCount(0);
  await app.close();
});

test("a layout or a grid chosen on the empty workspace fills it with panes that each have Add module", async () => {
  const { app, page } = await launch();
  // The card must sit above the docking area, or the buttons on it cannot be clicked.
  await page.getByTestId("empty-template-main-stacked").click({ timeout: 3000 });
  const slots = page.locator("[data-testid^='empty-slot-']");
  await expect(slots).toHaveCount(3);
  await expect(page.getByTestId("empty-workspace")).toHaveCount(0);
  await slots.first().getByTestId("slot-add-module").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await app.close();

  const grid = await launch();
  await grid.page.getByTestId("layout-grid-3x2").click({ timeout: 3000 });
  await expect(grid.page.locator("[data-testid^='empty-slot-']")).toHaveCount(6);
  await grid.app.close();
});

test("React and vanilla modules load, get trusted game context and persist data", async () => {
  const { app, page, userData } = await launch();

  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await expect(panels(page)).toHaveCount(2);

  for (const moduleId of [VANILLA, REACT]) {
    await expectModuleText(app, moduleId, "status", "Connected");
    await expectModuleText(app, moduleId, "game", "Path of Exile 2");
  }

  for (let i = 0; i < 3; i++) await clickInModule(app, VANILLA, "increment");
  await clickInModule(app, REACT, "increment");
  await expectModuleText(app, VANILLA, "count", "3");
  await expectModuleText(app, REACT, "count", "1");

  // Closing a panel removes the panel, never the module's data.
  await panels(page, VANILLA).getByTestId("close").click();
  await expect(panels(page)).toHaveCount(1);
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "count", "3");

  // Each game has its own workspace and its own module data.
  await openGame(page, "satisfactory");
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "game", "Satisfactory");
  await expectModuleText(app, VANILLA, "count", "0");

  await openGame(page, "poe2");
  await expect(panels(page)).toHaveCount(2);
  await expectModuleText(app, VANILLA, "count", "3");
  await expectModuleText(app, REACT, "count", "1");

  // Layout and data survive a restart.
  await app.close();
  const again = await launch(userData);
  await expect(panels(again.page)).toHaveCount(2);
  await expectModuleText(again.app, VANILLA, "count", "3");
  await expectModuleText(again.app, REACT, "count", "1");
  await again.app.close();
});

test("modules receive resize events matching their panel size", async () => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await expectModuleText(app, VANILLA, "status", "Connected");

  await setContentSize(app, RAIL_WIDTH + 1000, 700);
  // Two equal cards in 1000px less the 8px margins either side and the 8px gap
  // between them, each less its 1px borders. Height: the window less the
  // header (56px), the margin below (8px), the tab bar (36px) and the borders.
  await expectModuleText(app, VANILLA, "viewport", "486 × 598");
  await expectModuleText(app, REACT, "viewport", "486 × 598");
  expect(await inModule(app, VANILLA, "[innerWidth, innerHeight].join('x')")).toBe("486x598");
  await app.close();
});
