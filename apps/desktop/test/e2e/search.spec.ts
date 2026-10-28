// Ctrl+K search and the Settings search box.
import { expect, test } from "@playwright/test";
import { gameService } from "./fake-games";
import { inModule, launch, openWorkspace, openModule, panels, VANILLA } from "./harness";

test("Tavora's shortcuts open the overview, Settings, Home and numbered workspaces", async () => {
  const { app, page } = await launch();
  await page.keyboard.press("Control+/");
  // The list is its own Settings section, not a dialog of its own.
  await expect(page.getByTestId("settings").getByTestId("shortcuts")).toBeVisible();
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

test("Ctrl+K finds workspaces, modules and settings and runs them", async () => {
  const { app, page } = await launch();
  await page.keyboard.press("Control+K");
  const search = page.getByTestId("search");
  await expect(search).toBeVisible();
  await expect(page.getByTestId("search-input")).toBeFocused();

  // Arrow keys move through the results; Enter opens the selected one.
  await page.getByTestId("search-input").fill("satis");
  await expect(page.getByTestId("search-workspace-satisfactory")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(search).toHaveCount(0);
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveAttribute("aria-current", "page");

  // Modules of the current workspace can be opened from the box.
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

test("Ctrl+K puts your own things before games to add, and offers few of those", async () => {
  const { url, server } = await gameService([
    { id: "thememory", name: "TheMemory" },
    { id: "theme-park-studio", name: "Theme Park Studio" },
    { id: "theme-hospital", name: "Theme Hospital" },
    { id: "theme-aquarium", name: "Theme Aquarium" },
    // Contains the text without starting a word: never suggested unasked.
    { id: "anathema", name: "Anathema" },
  ]);
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  await page.keyboard.press("Control+K");
  await page.getByTestId("search-input").fill("theme");
  const options = page.getByTestId("search").locator('[role="option"]');
  await expect(page.getByTestId("search-add-game-theme-aquarium")).toBeVisible();
  // The Theme setting comes first; the games to add sit at the end, three at most.
  await expect(options.first()).toHaveAttribute("data-testid", "search-setting-theme");
  const ids = await options.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  const games = ids.filter((id) => id?.startsWith("search-add-game-"));
  expect(games).toHaveLength(3);
  expect(ids.slice(-3)).toEqual(games);
  expect(games).not.toContain("search-add-game-anathema");
  await page.keyboard.press("Escape");
  await app.close();
  server.close();
});

test("Ctrl+K works while a module panel has focus", async () => {
  const { app, page } = await launch();
  await openWorkspace(page, "poe2");
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

test("Settings search finds settings and workspaces in Trash", async () => {
  const { app, page } = await launch();
  await page.getByTestId("rail-workspace-satisfactory").click({ button: "right" });
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
