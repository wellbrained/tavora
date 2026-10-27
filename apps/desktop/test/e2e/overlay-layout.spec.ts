import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { launch, newUserData, openModule, seedLibrary } from "./harness";
import type { LayoutView } from "../../src/shared/layout-view";

// The Overlay page, in the hidden test app (never on screen): the real controller, canvas views and pages, on the
// overlay setups moved from a file of Tavora 0.21.43 (version 4).

const MODULES = path.resolve("../../modules");
const GAME = "poe2";

type Host = { tavoraHost: { act(action: unknown): Promise<unknown>; layout: { getState(): Promise<LayoutView>; send(message: unknown): void } } };

async function seed(userData: string, general = false) {
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), gameOverlays: true }));
  const anchor = { h: "left", v: "top", x: 0.036, y: 0.03, width: 0.356, height: 0.16 };
  const overlay = (key: string, workspaceId: string, scope: "game" | "all") => ({ owner: "official", moduleId: "tavora.clock-counter", workspaceId, key, scope, mode: "always", opacity: 100, hideFromCapture: false, rect: { x: 0.036, y: 0.03, width: 0.2, height: 0.16 }, anchor });
  // With `general`: one from a personal workspace too, and a place of its own over the game that the move doesn't keep.
  const overlays = general ? [overlay("own", GAME, "game"), overlay("a", "personal", "all")] : [overlay("a", GAME, "game")];
  const games = general ? { [GAME]: { detached: false, positions: { "official\ntavora.clock-counter\npersonal\na": { ...anchor, x: 0.5 } } } } : {};
  await writeFile(path.join(userData, "game-overlays.json"), JSON.stringify({ version: 4, overlays, panels: [], layout: { seen: { [GAME]: { width: 1920, height: 1080 } }, games } }));
}

/** Opens the Overlay page (on a setup, or on the one it picks itself) and waits for its canvas views. */
async function overlayPage(app: ElectronApplication, page: Page, setup?: string): Promise<Page> {
  await page.evaluate((setup) => (window as unknown as Host).tavoraHost.act({ type: "open-overlay-page", ...(setup ? { setup } : {}) }), setup);
  await expect(page.getByTestId("overlay-page")).toBeVisible();
  await expect.poll(() => app.windows().some((candidate) => candidate.url().endsWith("#layer"))).toBe(true);
  return page;
}

const layerOf = (app: ElectronApplication) => app.windows().find((candidate) => candidate.url().endsWith("#layer"))!;
const state = (page: Page) => page.evaluate(() => (window as unknown as Host).tavoraHost.layout.getState());
/** The row of an item or panel in the Sources list. */
const row = (page: Page, id: string) => page.getByTestId(`layout-source-${id}`);

test("The old file moves to setups once, each setup keeps its own place and opacity for an item, and opacity menus keep a preview", async () => {
  const userData = await newUserData();
  await seed(userData, true);
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    await overlayPage(app, page, GAME);
    // The game's own overlay and a copy of the general one, at the All games place: the old per-game place is gone.
    await expect.poll(async () => (await state(page))?.items.length).toBe(2);
    expect((await state(page)).games.map((game) => game.id)).toEqual(["$everywhere", "$all", GAME]);
    const general = (await state(page)).items[1]!;
    expect(general.id).toContain("personal");
    expect(general.placed.x).toBe(39);

    const choose = async (setupId: string) => {
      await page.getByRole("button", { name: "Overlay for", exact: true }).click();
      await page.getByTestId(`layout-game-option-${setupId}`).click();
      await expect.poll(async () => (await state(page)).gameId).toBe(setupId);
    };
    const itemOf = async () => (await state(page)).items.find((item) => item.id === general.id)!;
    const place = async (x: number) => {
      await page.evaluate(({ id, x }) => (window as unknown as Host).tavoraHost.layout.send({ type: "commit", id, rect: { x, y: 100, width: 300, height: 200 } }), { id: general.id, x });
      await expect.poll(async () => (await itemOf()).placed.x).toBe(x);
    };
    await choose("$all");
    expect((await state(page)).items.map((item) => item.name)).toEqual(["Clock & Counter"]);
    await place(200);
    await choose(GAME);
    expect((await itemOf()).placed.x).toBe(39);
    await place(600);
    await choose("$all");
    expect((await itemOf()).placed.x).toBe(200);
    await choose(GAME);
    expect((await itemOf()).placed.x).toBe(600);

    await row(page, general.id).getByRole("button").first().click();
    await expect(page.getByTestId("layout-stills").locator("img")).toHaveCount(0);
    await page.getByTestId(`layout-opacity-${general.id}`).click();
    await expect.poll(() => page.getByTestId("layout-stills").locator("img").count()).toBeGreaterThan(0);
    await page.getByRole("option", { name: "50%", exact: true }).click();
    await expect.poll(async () => (await itemOf()).opacity).toBe(50);
    await choose("$all");
    expect((await itemOf()).opacity).toBe(100);
    expect((await itemOf()).placed.x).toBe(200);
  } finally {
    await app.close();
  }
  // Written as setups at start, with the old file kept in the backups.
  const saved = JSON.parse(await readFile(path.join(userData, "game-overlays.json"), "utf8"));
  expect(saved.version).toBe(5);
  expect(saved.setups.map((setup: { id: string }) => setup.id)).toEqual(["$everywhere", "$all", GAME]);
  expect(saved.setups[0].overlays).toEqual([]);
  const backup = JSON.parse(await readFile(path.join(userData, "backups", "before-overlay-setups", "game-overlays.json"), "utf8"));
  expect(backup.version).toBe(4);
  expect(backup.overlays).toHaveLength(2);
});

test("Reset position and Reset size work from the page, Take picture says why it is off, and Back leaves with the canvas views", async () => {
  const userData = await newUserData();
  await seed(userData);
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    await overlayPage(app, page, GAME);
    await expect.poll(async () => (await state(page))?.items?.length).toBe(1);
    const first = (await state(page)).items[0]!;
    const id: string = first.id;
    await row(page, id).getByRole("button").first().click();
    await expect.poll(async () => (await state(page)).selection).toBe(id);
    await expect(page.getByTestId("layout-settings")).toContainText("Clock & Counter");

    // Drag it with the mouse on the layer, as the user does.
    const layer = layerOf(app);
    const outline = layer.locator('[data-testid^="layout-item-"]').first();
    await expect(outline).toBeVisible();
    const box = (await outline.boundingBox())!;
    await layer.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await layer.mouse.down();
    await layer.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 6 });
    await layer.mouse.up();
    await expect.poll(async () => (await state(page)).canUndo).toBe(true);
    await expect.poll(async () => (await state(page)).items[0]!.placed.x).toBeGreaterThan(300);
    const dropped = (await state(page)).items[0]!.placed;
    const droppedLeft = await outline.evaluate((node) => (node as HTMLElement).style.left);

    await page.locator('[data-testid^="layout-reset-"]:not([data-testid^="layout-reset-size-"])').click();
    await expect.poll(async () => (await state(page)).items[0]!.placed).toMatchObject({ x: 39, y: 32, width: dropped.width, height: dropped.height });
    // The layer follows (its outline is where the item is).
    await expect.poll(() => outline.evaluate((node) => (node as HTMLElement).style.left)).not.toBe(droppedLeft);

    const handle = layer.getByTestId("layout-handle-r");
    const handleBox = (await handle.boundingBox())!;
    await layer.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await layer.mouse.down();
    await layer.mouse.move(handleBox.x + handleBox.width / 2 + 60, handleBox.y + handleBox.height / 2, { steps: 6 });
    await layer.mouse.up();
    await expect.poll(async () => (await state(page)).items[0]!.placed.width).toBeGreaterThan(first.placed.width);
    await page.locator('[data-testid^="layout-reset-size-"]').click();
    await expect.poll(async () => (await state(page)).items[0]!.placed.width).toBe(first.placed.width);

    // The game isn't running: Take picture is off and says why.
    await expect(page.getByTestId("layout-take-picture")).toBeDisabled();
    await expect(page.getByTestId("layout-take-picture-hint")).toHaveAttribute("title", "Start the game first.");
    expect((await state(page)).pictureHint).toBe("start");

    // Back is the workspace again, and the views over the canvas go.
    await page.getByTestId("layout-done").click();
    await expect(page.getByTestId("workspace")).toBeVisible();
    await expect(page.getByTestId("overlay-page")).toHaveCount(0);
    await expect.poll(() => app.windows().some((candidate) => candidate.url().endsWith("#layer"))).toBe(false);
  } finally {
    await app.close();
  }
});

test("The page opens on Everywhere, lists every panel with the reason one can't go in, adds one, and the rail adds and removes a game's overlay", async () => {
  const userData = await newUserData();
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), gameOverlays: true }));
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    await openModule(page, "tavora.todos");
    await overlayPage(app, page);
    // No game runs, and nothing was set up: Everywhere, and Add overlay for every game.
    await expect.poll(async () => (await state(page))?.gameId).toBe("$everywhere");
    const view = await state(page);
    expect(view.games.map((game) => game.id)).toEqual(["$everywhere", "$all"]);
    expect(view.addable.map((game) => game.id)).toEqual(["poe2", "satisfactory"]);
    expect(view.sources).toHaveLength(1);
    const todos = view.sources[0]!;
    expect(todos).toMatchObject({ name: "To-Dos", from: "Path of Exile 2", game: "Path of Exile 2", block: "game-only" });
    // A game's panel can't go into Everywhere: greyed out, with the reason.
    await expect(row(page, todos.id)).toContainText("Only for Path of Exile 2");
    await expect(row(page, todos.id).getByRole("button").first()).toBeDisabled();
    await expect(page.getByTestId("layout-pick")).toBeVisible();

    // The search narrows the list.
    await page.getByTestId("layout-search").fill("zzz");
    await expect(row(page, todos.id)).toHaveCount(0);
    await page.getByTestId("layout-search").fill("to-do");
    await expect(row(page, todos.id)).toBeVisible();
    await page.getByTestId("layout-search").fill("");

    // Add overlay for the game from the dropdown: its setup opens, and the panel can be added there.
    await page.getByRole("button", { name: "Overlay for", exact: true }).click();
    await page.getByTestId(`layout-game-option-add:${GAME}`).click();
    await expect.poll(async () => (await state(page)).gameId).toBe(GAME);
    expect((await state(page)).addable.map((game) => game.id)).toEqual(["satisfactory"]);
    await row(page, todos.id).getByRole("button").first().click();
    await expect.poll(async () => (await state(page)).items.length).toBe(1);
    expect((await state(page)).selection).toContain(todos.id);
    await expect(page.getByTestId("layout-count")).toHaveText("1 of 8");
    await expect(page.getByTestId("layout-settings")).toContainText("To-Dos");
    await expect(row(page, todos.id).getByLabel("Already here")).toBeVisible();

    // The rail: Remove overlay for the game takes its setup away, Add overlay brings an empty one back.
    const railMenu = async (workspaceId: string, item: string) => {
      await page.getByTestId(`rail-workspace-${workspaceId}`).click({ button: "right" });
      await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
    };
    await expect(page.getByTestId("rail-workspace-satisfactory")).toBeVisible();
    await railMenu(GAME, "menu-remove-overlay");
    await expect.poll(async () => (await state(page)).games.map((game) => game.id)).toEqual(["$everywhere", "$all"]);
    expect((await state(page)).gameId).toBe("$all");
    expect((await state(page)).addable.map((game) => game.id)).toEqual(["poe2", "satisfactory"]);
    await railMenu(GAME, "menu-add-overlay");
    await expect.poll(async () => (await state(page)).games.map((game) => game.id)).toEqual(["$everywhere", "$all", GAME]);
  } finally {
    await app.close();
  }
  const saved = JSON.parse(await readFile(path.join(userData, "game-overlays.json"), "utf8"));
  expect(saved.version).toBe(5);
  expect(saved.setups.map((setup: { id: string }) => setup.id)).toEqual(["$everywhere", "$all", GAME]);
});
