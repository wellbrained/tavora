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
  await app.close();
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
  // Two equal columns of 500px; the panel area is the window minus the rail,
  // the toolbar (48px) and panel headers (28px).
  await expectModuleText(app, VANILLA, "viewport", "500 × 624");
  await expectModuleText(app, REACT, "viewport", "500 × 624");
  expect(await inModule(app, VANILLA, "[innerWidth, innerHeight].join('x')")).toBe("500x624");
  await app.close();
});

test("panels are refused when they would be smaller than the module's minimum size", async () => {
  const { app, page } = await launch();
  await setContentSize(app, RAIL_WIDTH + 1000, 700);
  // minWidth is 320, so three panels fit in 1000px and a fourth does not.
  for (let i = 0; i < 4; i++) await openModule(page, VANILLA);
  await expect(panels(page)).toHaveCount(3);
  await expect(page.getByTestId("notice")).toContainText("Not enough room");
  await app.close();
});
