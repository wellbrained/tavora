// The game library on the rail: adding, arranging, Trash and the app
// preferences that go with it.
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectModuleText,
  launch,
  newUserData,
  noteText,
  openGame,
  openModule,
  panels,
  setContentSize,
  saveNote,
  VANILLA,
} from "./harness";

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

async function fromMenu(page: Page, gameId: string, ...items: string[]) {
  await page.getByTestId(`rail-game-${gameId}`).click({ button: "right" });
  // Closed menus can linger while they animate out, so only look in open ones.
  for (const item of items) await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
}

async function answerPrompt(page: Page, value: string) {
  await page.getByTestId("prompt-input").fill(value);
  await page.getByTestId("prompt-submit").click();
  await expect(page.getByTestId("prompt")).toHaveCount(0);
}

/** Opens a game, adds the vanilla module and saves a note in it. */
async function noteIn(running: Awaited<ReturnType<typeof launch>>, gameId: string, text: string) {
  const { app, page } = running;
  await openGame(page, gameId);
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "status", "Connected");
  await saveNote(app, VANILLA, text);
  await expectModuleText(app, VANILLA, "note-revision", "1");
}

test("players add games from the built-in list or by name", async () => {
  const running = await launch(undefined, [], { seed: false });
  const { page, userData } = running;
  await expect(page.getByTestId("welcome")).toContainText("Welcome to Tavora");

  await page.getByTestId("welcome-add-game").click();
  await page.getByTestId("game-search").fill("elden");
  await page.getByTestId("catalog-elden-ring").click();
  // A new game opens straight away, with an empty workspace.
  await expect(page.getByTestId("rail-game-elden-ring")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("workspace")).toContainText("Elden Ring");
  await expect(page.getByTestId("empty-workspace")).toBeVisible();

  await page.getByTestId("rail-add-game").click();
  // Games already in the library are not offered again.
  await page.getByTestId("game-search").fill("elden");
  await expect(page.getByTestId("catalog-elden-ring")).toHaveCount(0);
  await page.getByTestId("game-search").fill("My Indie Game");
  await page.getByTestId("add-custom").click();
  await expect(page.getByTestId("rail-game-local-my-indie-game")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("rail-game-local-my-indie-game")).toContainText("MIG");
  await running.app.close();

  const again = await launch(userData);
  // Starts on the last game played.
  await expect(again.page.getByTestId("rail-game-local-my-indie-game")).toHaveAttribute("aria-current", "page");
  await expect(again.page.getByTestId("rail-game-elden-ring")).toBeVisible();
  await again.app.close();
});

test("games are renamed, favorited and put in folders from their menu", async () => {
  const { app, page, userData } = await launch();

  await fromMenu(page, "satisfactory", "menu-rename");
  await answerPrompt(page, "Satisfactory 1.0");
  await expect(page.getByTestId("rail-game-satisfactory")).toHaveAttribute("aria-label", "Satisfactory 1.0");

  await fromMenu(page, "satisfactory", "menu-icon", "menu-icon-label");
  await answerPrompt(page, "SF");
  await expect(page.getByTestId("rail-game-satisfactory")).toContainText("SF");

  await fromMenu(page, "poe2", "menu-favorite");
  await expect(page.getByTestId("rail-favorite-poe2")).toBeVisible();

  await fromMenu(page, "satisfactory", "menu-move-to-folder", "menu-new-folder");
  await answerPrompt(page, "Builders");
  const folder = page.locator('[data-testid^="rail-folder-"][data-testid$="-toggle"]');
  await expect(folder).toHaveAttribute("aria-label", "Folder Builders");
  // Folders start closed; their games show when opened.
  await expect(page.getByTestId("rail-game-satisfactory")).toHaveCount(0);
  await folder.click();
  await expect(page.getByTestId("rail-game-satisfactory")).toBeVisible();
  await app.close();

  // All of it is saved.
  const again = await launch(userData);
  await expect(again.page.getByTestId("rail-favorite-poe2")).toBeVisible();
  await again.page.locator('[data-testid^="rail-folder-"][data-testid$="-toggle"]').click();
  await expect(again.page.getByTestId("rail-game-satisfactory")).toHaveAttribute("aria-label", "Satisfactory 1.0");

  await fromMenu(again.page, "satisfactory", "menu-unfolder");
  // The folder stays, now empty.
  await expect(again.page.locator('[data-testid^="rail-folder-"][data-testid$="-toggle"]')).toHaveCount(1);
  await expect(again.page.getByTestId("rail-game-satisfactory")).toBeVisible();
  await again.app.close();
});

test("games can be reordered by dragging them on the rail", async () => {
  const { app, page } = await launch();
  const order = () =>
    page.locator('[data-testid="rail"] [data-testid^="rail-game-"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-testid")));
  expect(await order()).toEqual(["rail-game-poe2", "rail-game-satisfactory"]);
  // Playwright's mouse drag does not drive HTML drag and drop in Electron,
  // so the drag events are sent directly, as the browser would.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const target = (await page.getByTestId("rail-game-poe2").boundingBox())!;
  const at = { dataTransfer, clientX: target.x + 24, clientY: target.y + 2 };
  await page.getByTestId("rail-game-satisfactory").dispatchEvent("dragstart", { dataTransfer });
  await page.getByTestId("rail-game-poe2").dispatchEvent("dragover", at);
  await page.getByTestId("rail-game-poe2").dispatchEvent("drop", at);
  await page.getByTestId("rail-game-satisfactory").dispatchEvent("dragend", { dataTransfer });
  await expect.poll(order).toEqual(["rail-game-satisfactory", "rail-game-poe2"]);
  await app.close();
});

test("a removed game keeps its data in Trash and comes back when restored", async () => {
  const running = await launch();
  const { app, page } = running;
  await noteIn(running, "satisfactory", "factory plans");

  await fromMenu(page, "satisfactory", "menu-remove");
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("rail-game-satisfactory")).toHaveCount(0);
  await expect(page.getByTestId("welcome")).toBeVisible();
  await expect(panels(page)).toHaveCount(0);

  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-trash").click();
  await expect(page.getByTestId("trash-satisfactory")).toContainText("Satisfactory");
  await page.getByTestId("restore-satisfactory").click();
  await expect(page.getByTestId("trash-empty")).toBeVisible();
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings")).toHaveCount(0);

  // Its workspace and module data are back as they were.
  await openGame(page, "satisfactory");
  await expect(panels(page, VANILLA)).toHaveCount(1);
  await expectModuleText(app, VANILLA, "status", "Connected");
  await expect.poll(() => noteText(app, VANILLA)).toBe("factory plans");
  await app.close();
});

test("a game in Trash is deleted for good after 30 days or when the player says so", async () => {
  const userData = await newUserData();
  const running = await launch(userData);
  const { page } = running;
  await noteIn(running, "satisfactory", "factory plans");
  await fromMenu(page, "satisfactory", "menu-remove");
  await page.getByTestId("confirm-submit").click();
  await fromMenu(page, "poe2", "menu-remove");
  await page.getByTestId("confirm-submit").click();

  // Delete now, from Settings.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-trash").click();
  await page.getByTestId("delete-poe2").click();
  await page.getByTestId("confirm-submit").click();
  // The confirmation opened over Settings, which is still open.
  await expect(page.getByTestId("trash-poe2")).toHaveCount(0);
  await expect(page.getByTestId("trash-satisfactory")).toBeVisible();
  await running.app.close();

  const dataDir = path.join(userData, "module-data", VANILLA, "satisfactory");
  expect(await exists(dataDir)).toBe(true);
  const gamePartitions = async () =>
    (await readdir(path.join(userData, "Partitions")).catch(() => [] as string[]))
      .map((name) => decodeURIComponent(name).toLowerCase())
      .filter((name) => name.endsWith("@satisfactory"));
  expect(await gamePartitions()).toEqual([`module:${VANILLA}@satisfactory`]);

  // Thirty-one days later.
  const libraryFile = path.join(userData, "library.json");
  const library = JSON.parse(await readFile(libraryFile, "utf8"));
  library.games.satisfactory.trashedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  await writeFile(libraryFile, JSON.stringify(library));

  const again = await launch(userData);
  await again.page.getByTestId("rail-settings").click();
  await again.page.getByTestId("settings-nav-trash").click();
  await expect(again.page.getByTestId("trash-empty")).toBeVisible();
  expect(await exists(dataDir)).toBe(false);
  expect(await gamePartitions()).toEqual([]);
  await again.page.keyboard.press("Escape");

  // Added again, the game starts from nothing.
  await again.page.getByTestId("rail-add-game").click();
  await again.page.getByTestId("game-search").fill("satisf");
  await again.page.getByTestId("catalog-satisfactory").click();
  await expect(again.page.getByTestId("empty-workspace")).toBeVisible();
  await openModule(again.page, VANILLA);
  await expectModuleText(again.app, VANILLA, "status", "Connected");
  await expectModuleText(again.app, VANILLA, "note-revision", "0");
  await again.app.close();
});

test("the rail remembers whether it is expanded and how wide it is", async () => {
  const { app, page, userData } = await launch();
  const rail = page.getByTestId("rail");
  await expect(rail).toHaveAttribute("data-expanded", "false");
  expect((await rail.boundingBox())!.width).toBe(72);

  await page.getByTestId("rail-toggle").click();
  await expect(rail).toHaveAttribute("data-expanded", "true");
  await expect(page.getByTestId("rail-game-poe2")).toContainText("Path of Exile 2");
  await page.getByTestId("rail-resize").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await rail.boundingBox())!.width).toBe(288);
  await app.close();

  const again = await launch(userData);
  await expect(again.page.getByTestId("rail")).toHaveAttribute("data-expanded", "true");
  expect((await again.page.getByTestId("rail").boundingBox())!.width).toBe(288);
  await again.app.close();
});

test("an expanded rail turns compact in a narrow window and comes back when it widens", async () => {
  const { app, page, userData } = await launch();
  const rail = page.getByTestId("rail");
  await page.getByTestId("rail-toggle").click();
  await expect(rail).toHaveAttribute("data-expanded", "true");

  await setContentSize(app, 960, 600);
  await expect(rail).toHaveAttribute("data-expanded", "false");
  await expect(page.getByTestId("rail-toggle")).toBeInViewport();

  // Expanding in a narrow window is only for now; the saved setting stays.
  await page.getByTestId("rail-toggle").click();
  await expect(rail).toHaveAttribute("data-expanded", "true");
  await page.getByTestId("rail-toggle").click();
  await expect(rail).toHaveAttribute("data-expanded", "false");

  await setContentSize(app, 1400, 900);
  await expect(rail).toHaveAttribute("data-expanded", "true");
  await app.close();
  const saved = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8"));
  expect(saved.rail.expanded).toBe(true);
});

test("Tavora starts on Home or on the last game, as chosen in Settings", async () => {
  const { app, page, userData } = await launch();
  await expect(page.getByTestId("rail-game-poe2")).toHaveAttribute("aria-current", "page");

  // Settings opens over the game, which stays where it was.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("startup-welcome").click();
  await expect(page.getByTestId("startup-welcome")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings")).toHaveCount(0);
  await expect(page.getByTestId("rail-game-poe2")).toHaveAttribute("aria-current", "page");
  await app.close();

  const again = await launch(userData);
  await expect(again.page.getByTestId("welcome")).toContainText("Welcome back");
  await expect(again.page.getByTestId("recent-poe2")).toBeVisible();
  await again.app.close();
});
