// The game library on the rail: adding, arranging, Trash and the app
// preferences that go with it.
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  desktopDir,
  expectModuleText,
  launch,
  newUserData,
  NOTES,
  noteText,
  openWorkspace,
  openModule,
  panels,
  setContentSize,
  saveNote,
  seedLibrary,
  TODOS,
  VANILLA,
} from "./harness";
import { gameService } from "./fake-games";

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

async function fromMenu(page: Page, gameId: string, ...items: string[]) {
  await page.getByTestId(`rail-workspace-${gameId}`).click({ button: "right" });
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
  await openWorkspace(page, gameId);
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "status", "Connected");
  await saveNote(app, VANILLA, text);
  await expectModuleText(app, VANILLA, "note-revision", "1");
}

test("the first-run welcome takes a name and games, and can be shown again", async () => {
  const { app, page, userData } = await launch(undefined, [], { seed: false });
  await page.getByTestId("onboarding-name").fill("Robin");
  await page.getByTestId("onboarding-next").click();
  // Next waits for a game; skipping stays possible.
  await expect(page.getByTestId("onboarding-next")).toBeDisabled();
  await expect(page.getByTestId("onboarding-skip-games")).toBeVisible();
  // A popular game is one click, and leaves the tiles once it is added.
  await page.getByTestId("onboarding-game-minecraft").click();
  await expect(page.getByTestId("onboarding-games")).toContainText("Minecraft");
  await expect(page.getByTestId("onboarding-game-minecraft")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-next")).toBeEnabled();
  // Any other game comes from the search.
  await page.getByTestId("onboarding-add-game").click();
  await page.getByTestId("game-search").fill("hollow");
  await page.getByTestId("catalog-hollow-knight").click();
  // Adding a game here keeps the welcome open and lists the game.
  await expect(page.getByTestId("onboarding-games")).toContainText("Hollow Knight");
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-done").click();
  await expect(page.getByTestId("welcome")).toContainText("Welcome back");
  await expect(page.getByTestId("rail-profile")).toHaveAttribute("aria-label", "Profile: Robin");
  await app.close();

  const again = await launch(userData);
  await expect(again.page.getByTestId("onboarding")).toHaveCount(0);
  await again.page.getByTestId("rail-settings").click();
  await again.page.getByTestId("show-welcome-again").click();
  await expect(again.page.getByTestId("onboarding")).toBeVisible();
  await again.app.close();
});

test("the Add a game list ranks real name starts first and sorts by the name shown", async () => {
  const { url, server } = await gameService([
    { id: "eldoran", name: "Eldoran" },
    { id: "eldevin", name: "Eldevin" },
    { id: "eldgear", name: "Eldgear" },
  ]);
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  await page.getByTestId("rail-add-game").click();
  const rows = page.getByTestId("add-game-dialog").locator('[data-testid^="catalog-"]');
  // Nothing typed: the first games by the name you see, so Sid Meier's game is not between B and C.
  await expect(rows.first()).toHaveAttribute("data-testid", "catalog-age-of-empires-2");
  await expect(rows.nth(4)).toHaveAttribute("data-testid", "catalog-battlefield-6");
  await expect(rows.nth(5)).toHaveAttribute("data-testid", "catalog-counter-strike-2");

  await page.getByTestId("game-search").fill("eld");
  await expect(page.getByTestId("catalog-eldoran")).toBeVisible();
  const ids = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  expect(ids).toEqual([
    "catalog-elden-ring",
    "catalog-eldevin",
    "catalog-eldgear",
    "catalog-eldoran",
    "catalog-skyrim",
    "catalog-battlefield-6",
    "catalog-starfield",
  ]);
  await app.close();
  server.close();
});

test("users add games from the built-in list or by name", async () => {
  const running = await launch(undefined, [], { seed: false });
  const { page, userData } = running;
  // A new install starts with the first-run welcome; skipping it leads Home.
  await page.getByTestId("onboarding-skip").click();
  await expect(page.getByTestId("welcome")).toContainText("Welcome to Tavora");

  await page.getByTestId("welcome-add-game").click();
  await page.getByTestId("game-search").fill("elden");
  await page.getByTestId("catalog-elden-ring").click();
  // A new game opens straight away, with Notes and To-Dos side by side.
  await expect(page.getByTestId("rail-workspace-elden-ring")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("workspace")).toContainText("Elden Ring");
  await expect(panels(page, NOTES)).toHaveCount(1);
  await expect(panels(page, TODOS)).toHaveCount(1);
  await expect(page.locator(".dv-groupview")).toHaveCount(2);
  await expect(page.getByTestId("empty-workspace")).toHaveCount(0);
  // Closing both leaves the empty card: Add module first, the layouts below it.
  await panels(page, NOTES).getByTestId("close").click();
  await panels(page, TODOS).getByTestId("close").click();
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  await expect(page.getByTestId("empty-add-module")).toBeVisible();

  await page.getByTestId("rail-add-game").click();
  // Games already in the library are not offered again.
  await page.getByTestId("game-search").fill("elden");
  await expect(page.getByTestId("catalog-elden-ring")).toHaveCount(0);
  await page.getByTestId("game-search").fill("My Indie Game");
  await page.getByTestId("add-custom").click();
  await expect(page.getByTestId("rail-workspace-local-my-indie-game")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("rail-workspace-local-my-indie-game")).toContainText("MIG");
  // A game added by name gets the same starter.
  await expect(panels(page, NOTES)).toHaveCount(1);
  await expect(panels(page, TODOS)).toHaveCount(1);
  // Closing from the test skips the app's wait for pending saves: let the layout settle first.
  await page.waitForTimeout(500);
  await running.app.close();

  const again = await launch(userData);
  // Starts on the last game played.
  await expect(again.page.getByTestId("rail-workspace-local-my-indie-game")).toHaveAttribute("aria-current", "page");
  await expect(again.page.getByTestId("rail-workspace-elden-ring")).toBeVisible();
  await again.app.close();
});

test("workspaces are renamed, favorited and put in folders from their menu", async () => {
  const { app, page, userData } = await launch();

  await fromMenu(page, "satisfactory", "menu-rename");
  await answerPrompt(page, "Satisfactory 1.0");
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveAttribute("aria-label", "Satisfactory 1.0");

  await fromMenu(page, "satisfactory", "menu-icon", "menu-icon-label");
  await answerPrompt(page, "SF");
  await expect(page.getByTestId("rail-workspace-satisfactory")).toContainText("SF");

  await fromMenu(page, "poe2", "menu-favorite");
  await expect(page.getByTestId("rail-favorite-poe2")).toBeVisible();
  // A favorite keeps its own menu items, the icon among them.
  await page.getByTestId("rail-favorite-poe2").click({ button: "right" });
  for (const item of ["menu-icon", "menu-icon-label"]) await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
  await answerPrompt(page, "P2");
  await expect(page.getByTestId("rail-favorite-poe2")).toContainText("P2");

  await fromMenu(page, "satisfactory", "menu-move-to-folder", "menu-new-folder");
  await answerPrompt(page, "Builders");
  const folder = page.locator('[data-testid^="rail-folder-"][data-testid$="-toggle"]');
  await expect(folder).toHaveAttribute("aria-label", "Folder Builders");
  // Folders start closed; their games show when opened.
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveCount(0);
  await folder.click();
  await expect(page.getByTestId("rail-workspace-satisfactory")).toBeVisible();
  await app.close();

  // All of it is saved.
  const again = await launch(userData);
  await expect(again.page.getByTestId("rail-favorite-poe2")).toBeVisible();
  await again.page.locator('[data-testid^="rail-folder-"][data-testid$="-toggle"]').click();
  await expect(again.page.getByTestId("rail-workspace-satisfactory")).toHaveAttribute("aria-label", "Satisfactory 1.0");

  await fromMenu(again.page, "satisfactory", "menu-unfolder");
  // The folder stays, now empty.
  await expect(again.page.locator('[data-testid^="rail-folder-"][data-testid$="-toggle"]')).toHaveCount(1);
  await expect(again.page.getByTestId("rail-workspace-satisfactory")).toBeVisible();
  await again.app.close();
});

test("dropping a workspace on a folder leaves the folder open or closed as it was", async () => {
  const { app, page } = await launch();
  await fromMenu(page, "satisfactory", "menu-move-to-folder", "menu-new-folder");
  await answerPrompt(page, "Builders");
  const folder = page.locator('[data-testid^="rail-folder-"][data-testid$="-toggle"]');
  await expect(folder).toHaveAttribute("aria-expanded", "false");

  // Playwright's mouse drag does not drive HTML drag and drop in Electron, so the events are sent directly.
  const drop = async (gameId: string) => {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    // The folder's draggable row takes the drops, not the button inside it.
    const row = folder.locator("xpath=ancestor::div[@draggable='true'][1]");
    await page.getByTestId(`rail-workspace-${gameId}`).dispatchEvent("dragstart", { dataTransfer });
    // The rail shifts once a drag starts, so the folder is measured after that.
    await page.waitForTimeout(100);
    const box = (await row.boundingBox())!;
    const at = (fraction: number) => ({ dataTransfer, clientX: box.x + box.width / 2, clientY: box.y + box.height * fraction });
    // Pointing at the middle of the folder means "into": aim until the row shows that.
    let into = at(0.5);
    for (const fraction of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      into = at(fraction);
      await row.dispatchEvent("dragover", into);
      await page.waitForTimeout(50);
      if (await row.evaluate((element) => element.classList.contains("drop-into"))) break;
    }
    await row.dispatchEvent("drop", into);
  };

  // Closed stays closed, with no games listed under it.
  await drop("poe2");
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("group", { name: "Builders" })).toHaveCount(0);

  // Opened by the user, the folder holds both games.
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  const inside = page.getByRole("group", { name: "Builders" });
  await expect(inside.getByTestId("rail-workspace-poe2")).toBeVisible();
  await expect(inside.getByTestId("rail-workspace-satisfactory")).toBeVisible();
  await app.close();
});

test("workspaces can be reordered by dragging them on the rail", async () => {
  const { app, page } = await launch();
  const order = () =>
    page.locator('[data-testid="rail"] [data-testid^="rail-workspace-"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-testid")));
  expect(await order()).toEqual(["rail-workspace-poe2", "rail-workspace-satisfactory"]);
  // Playwright's mouse drag does not drive HTML drag and drop in Electron,
  // so the drag events are sent directly, as the browser would.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const target = (await page.getByTestId("rail-workspace-poe2").boundingBox())!;
  const at = { dataTransfer, clientX: target.x + 24, clientY: target.y + 2 };
  await page.getByTestId("rail-workspace-satisfactory").dispatchEvent("dragstart", { dataTransfer });
  await page.getByTestId("rail-workspace-poe2").dispatchEvent("dragover", at);
  await page.getByTestId("rail-workspace-poe2").dispatchEvent("drop", at);
  await page.getByTestId("rail-workspace-satisfactory").dispatchEvent("dragend", { dataTransfer });
  await expect.poll(order).toEqual(["rail-workspace-satisfactory", "rail-workspace-poe2"]);
  await app.close();
});

test("a removed workspace keeps its data in Trash and comes back when restored", async () => {
  const running = await launch();
  const { app, page } = running;
  await noteIn(running, "satisfactory", "factory plans");

  await fromMenu(page, "satisfactory", "menu-remove");
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveCount(0);
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
  await openWorkspace(page, "satisfactory");
  await expect(panels(page, VANILLA)).toHaveCount(1);
  await expectModuleText(app, VANILLA, "status", "Connected");
  await expect.poll(() => noteText(app, VANILLA)).toBe("factory plans");
  await app.close();
});

test("many workspaces are moved to Trash, restored and deleted together from Settings", async () => {
  const { app, page } = await launch();
  await fromMenu(page, "poe2", "menu-manage-workspaces");
  await expect(page.getByTestId("settings-heading")).toHaveText("Workspaces");

  // A filter narrows what Select all ticks.
  await page.getByTestId("workspaces-filter").fill("path");
  await page.getByTestId("workspaces-select-all").check();
  await expect(page.getByTestId("workspaces-selected")).toHaveText("1 selected");
  await page.getByTestId("workspaces-filter").fill("");
  await page.getByTestId("workspaces-select-all").check();
  await expect(page.getByTestId("workspaces-selected")).toHaveText("2 selected");
  await page.getByTestId("workspaces-remove").click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("workspaces-empty")).toBeVisible();
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveCount(0);
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveCount(0);

  await page.getByTestId("settings-nav-trash").click();
  await page.getByTestId("trash-tick-poe2").check();
  await page.getByTestId("trash-restore-selected").click();
  await expect(page.getByTestId("trash-poe2")).toHaveCount(0);
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveCount(1);

  await page.getByTestId("trash-select-all").check();
  await page.getByTestId("trash-delete-selected").click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("trash-empty")).toBeVisible();
  await app.close();
});

test("a workspace in Trash is deleted for good after 30 days or when the user says so", async () => {
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

  const dataDir = path.join(userData, "module-data", "local", VANILLA, "satisfactory");
  expect(await exists(dataDir)).toBe(true);
  const gamePartitions = async () =>
    (await readdir(path.join(userData, "Partitions")).catch(() => [] as string[]))
      .map((name) => decodeURIComponent(name).toLowerCase())
      .filter((name) => name.endsWith("@satisfactory"));
  expect(await gamePartitions()).toEqual([`module:local:${VANILLA}@satisfactory`]);

  // Thirty-one days later.
  const libraryFile = path.join(userData, "library.json");
  const library = JSON.parse(await readFile(libraryFile, "utf8"));
  library.workspaces.satisfactory.trashedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
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
  await expect(panels(again.page, TODOS)).toHaveCount(1);
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
  await expect(page.getByTestId("rail-workspace-poe2")).toContainText("Path of Exile 2");
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

test("Tavora starts on Home or on the last workspace, as chosen in Settings", async () => {
  const { app, page, userData } = await launch();
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveAttribute("aria-current", "page");

  // Settings opens over the game, which stays where it was.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("startup-welcome").click();
  await expect(page.getByTestId("startup-welcome")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings")).toHaveCount(0);
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveAttribute("aria-current", "page");
  await app.close();

  const again = await launch(userData);
  await expect(again.page.getByTestId("welcome")).toContainText("Welcome back");
  // The game opened last waits in the Continue bar, not among the other recent games.
  await again.page.getByTestId("welcome-continue-button").click();
  await expect(again.page.getByTestId("rail-workspace-poe2")).toHaveAttribute("aria-current", "page");
  await again.app.close();
});

test("grayscale text is chosen in Settings and applies on the next start", async () => {
  const { app, page, userData } = await launch();
  const hasSwitch = (running: typeof app) => running.evaluate(({ app }) => app.commandLine.hasSwitch("disable-lcd-text"));
  expect(await hasSwitch(app)).toBe(false);

  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  const toggle = page.getByTestId("grayscale-text");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // One bar offers the restart; switching back means none is needed.
  await expect(page.getByTestId("restart-bar")).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("restart-bar")).toHaveCount(0);
  await toggle.click();
  await expect(page.getByTestId("restart-bar")).toBeVisible();
  await app.close();

  const again = await launch(userData);
  expect(await hasSwitch(again.app)).toBe(true);
  await again.page.getByTestId("rail-settings").click();
  await again.page.getByTestId("settings-nav-appearance").click();
  await expect(again.page.getByTestId("grayscale-text")).toHaveAttribute("aria-checked", "true");
  await expect(again.page.getByTestId("restart-bar")).toHaveCount(0);
  await again.app.close();
});

test("Home names a new Tavora version once, and its patch notes are one click away", async () => {
  const version = (JSON.parse(await readFile(path.join(desktopDir, "package.json"), "utf8")) as { version: string }).version;
  const libraryVersion = async (dir: string) => (JSON.parse(await readFile(path.join(dir, "library.json"), "utf8")) as { seenVersion?: string }).seenVersion;

  // A first start counts the running version as seen: no card.
  const fresh = await launch();
  try {
    await fresh.page.getByTestId("rail-home").click();
    await expect(fresh.page.getByTestId("welcome-away")).toBeVisible();
    await expect(fresh.page.getByTestId("welcome-away-news")).toHaveCount(0);
    await expect.poll(() => libraryVersion(fresh.userData)).toBe(version);
  } finally {
    await fresh.app.close();
  }

  // After an update: the card, and See what's new opens the patch notes and puts it away.
  const userData = await newUserData();
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), seenVersion: "0.0.1" }));
  const { app, page } = await launch(userData, [], { seed: false });
  try {
    await page.getByTestId("rail-home").click();
    const card = page.getByTestId("welcome-away-news");
    await expect(card).toContainText(`Tavora ${version} is here`);
    await card.getByRole("button", { name: "See what's new" }).click();
    await expect(page.getByTestId("settings-heading")).toHaveText("Patch notes");
    await expect.poll(() => libraryVersion(userData)).toBe(version);
    await page.getByTestId("settings-close").click();
    await expect(card).toHaveCount(0);
  } finally {
    await app.close();
  }
});
