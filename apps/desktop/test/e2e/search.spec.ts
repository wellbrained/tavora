// Ctrl+K search and the Settings search box.
import { expect, test } from "@playwright/test";
import { inModule, launch, openGame, openModule, panels, VANILLA } from "./harness";

test("Tavora's shortcuts open the overview, Settings, Home and numbered games", async () => {
  const { app, page } = await launch();
  await page.keyboard.press("Control+/");
  await expect(page.getByTestId("shortcuts")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await expect(page.getByTestId("settings")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+H");
  await expect(page.getByTestId("welcome")).toBeVisible();
  await page.keyboard.press("Control+1");
  await expect(page.getByTestId("workspace")).toBeVisible();
  await app.close();
});

test("Ctrl+K finds games, modules and settings and runs them", async () => {
  const { app, page } = await launch();
  await page.keyboard.press("Control+K");
  const search = page.getByTestId("search");
  await expect(search).toBeVisible();
  await expect(page.getByTestId("search-input")).toBeFocused();

  // Arrow keys move through the results; Enter opens the selected one.
  await page.getByTestId("search-input").fill("satis");
  await expect(page.getByTestId("search-game-satisfactory")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(search).toHaveCount(0);
  await expect(page.getByTestId("rail-game-satisfactory")).toHaveAttribute("aria-current", "page");

  // Modules of the current game can be opened from the box.
  await page.keyboard.press("Control+K");
  await page.getByTestId("search-input").fill("vanilla");
  await page.getByTestId(`search-module-${VANILLA}`).click();
  await expect(panels(page, VANILLA)).toHaveCount(1);

  // A setting opens Settings at that setting.
  await page.keyboard.press("Control+K");
  await page.getByTestId("search-input").fill("sorted");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("settings")).toBeVisible();
  await expect(page.locator('[data-setting="sort"]')).toHaveAttribute("data-highlighted", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings")).toHaveCount(0);

  // Nothing found says so; Escape closes the box.
  await page.keyboard.press("Control+K");
  await page.getByTestId("search-input").fill("zzzz");
  await expect(page.getByTestId("search-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await app.close();
});

test("Ctrl+K works while a module panel has focus", async () => {
  const { app, page } = await launch();
  await openGame(page, "poe2");
  await openModule(page, VANILLA);
  await expect.poll(() => inModule(app, VANILLA, "document.readyState").catch(() => null)).toBe("complete");
  await app.evaluate(({ webContents }, moduleId) => {
    const panel = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`))!;
    panel.focus();
    panel.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["control"] });
  }, VANILLA);
  await expect(page.getByTestId("search")).toBeVisible();
  await expect(page.getByTestId("search-input")).toBeFocused();
  await app.close();
});

test("Settings search finds settings and games in Trash", async () => {
  const { app, page } = await launch();
  await page.getByTestId("rail-game-satisfactory").click({ button: "right" });
  await page.locator('[role="menu"][data-state="open"] [data-testid="menu-remove"]').click();
  await page.getByTestId("confirm-submit").click();

  await page.getByTestId("rail-settings").click();
  const box = page.getByTestId("settings-search");
  await box.fill("start");
  await expect(page.getByTestId("settings-result-startup")).toBeVisible();
  await page.getByTestId("settings-result-startup").click();
  await expect(box).toHaveValue("");
  await expect(page.locator('[data-setting="startup"]')).toHaveAttribute("data-highlighted", "true");

  await box.fill("satisfactory");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("trash-satisfactory")).toHaveAttribute("class", /bg-primary/);

  await box.fill("nothing like this");
  await expect(page.getByTestId("settings-no-results")).toBeVisible();
  // The first Escape clears the search, the second closes Settings.
  await page.keyboard.press("Escape");
  await expect(box).toHaveValue("");
  await expect(page.getByTestId("settings")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings")).toHaveCount(0);
  await app.close();
});
