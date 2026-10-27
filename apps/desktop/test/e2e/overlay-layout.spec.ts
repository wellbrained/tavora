import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { launch, newUserData, seedLibrary } from "./harness";
import type { LayoutView } from "../../src/shared/layout-view";

// The Overlay layout window, in the hidden test app (never on screen): the real controller, windows and pages, on
// the overlay setups moved from a file of Tavora 0.21.43 (version 4).

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

async function layoutPage(app: ElectronApplication, page: Page): Promise<Page> {
  await page.evaluate(() => (window as unknown as Host).tavoraHost.act({ type: "open-overlay-layout", setup: "poe2" }));
  const is = (candidate: Page) => candidate.url().includes("layout.html") && candidate.url().endsWith("#shell");
  await expect.poll(() => app.windows().some(is)).toBe(true);
  return app.windows().find(is)!;
}

const state = (shell: Page) => shell.evaluate(() => (window as unknown as Host).tavoraHost.layout.getState());

test("The old file moves to setups once, each setup keeps its own place and opacity for an item, and opacity menus keep a preview", async () => {
  const userData = await newUserData();
  await seed(userData, true);
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    const shell = await layoutPage(app, page);
    // The game's own overlay and a copy of the general one, at the All games place: the old per-game place is gone.
    await expect.poll(async () => (await state(shell))?.items.length).toBe(2);
    expect((await state(shell)).games.map((game) => game.id)).toEqual(["$all", GAME]);
    const general = (await state(shell)).items[1]!;
    expect(general.id).toContain("personal");
    expect(general.placed.x).toBe(39);

    const choose = async (setupId: string) => {
      await shell.getByRole("button", { name: "Game", exact: true }).click();
      await shell.getByTestId(`layout-game-option-${setupId}`).click();
      await expect.poll(async () => (await state(shell)).gameId).toBe(setupId);
    };
    const itemOf = async () => (await state(shell)).items.find((item) => item.id === general.id)!;
    const place = async (x: number) => {
      await shell.evaluate(({ id, x }) => (window as unknown as Host).tavoraHost.layout.send({ type: "commit", id, rect: { x, y: 100, width: 300, height: 200 } }), { id: general.id, x });
      await expect.poll(async () => (await itemOf()).placed.x).toBe(x);
    };
    await choose("$all");
    expect((await state(shell)).items.map((item) => item.name)).toEqual(["Clock & Counter"]);
    await place(200);
    await choose(GAME);
    expect((await itemOf()).placed.x).toBe(39);
    await place(600);
    await choose("$all");
    expect((await itemOf()).placed.x).toBe(200);
    await choose(GAME);
    expect((await itemOf()).placed.x).toBe(600);

    await shell.getByTestId(`layout-row-${general.id}`).getByRole("button").first().click();
    await expect(shell.getByTestId("layout-stills").locator("img")).toHaveCount(0);
    await shell.getByTestId(`layout-opacity-${general.id}`).click();
    await expect.poll(() => shell.getByTestId("layout-stills").locator("img").count()).toBeGreaterThan(0);
    await shell.getByRole("option", { name: "50%", exact: true }).click();
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

test("Reset position and Reset size work from the list, and Take picture says why it is off", async () => {
  const userData = await newUserData();
  await seed(userData);
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    const shell = await layoutPage(app, page);
    await expect.poll(async () => (await state(shell))?.items?.length).toBe(1);
    const first = (await state(shell)).items[0]!;
    const id: string = first.id;
    const row = shell.locator('[data-testid^="layout-row-"]').first();
    await row.getByRole("button").first().click();
    await expect.poll(async () => (await state(shell)).selection).toBe(id);

    // Drag it with the mouse on the layer, as the user does.
    const layer = app.windows().find((candidate) => candidate.url().endsWith("#layer"))!;
    const outline = layer.locator('[data-testid^="layout-item-"]').first();
    await expect(outline).toBeVisible();
    const box = (await outline.boundingBox())!;
    await layer.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await layer.mouse.down();
    await layer.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 6 });
    await layer.mouse.up();
    await expect.poll(async () => (await state(shell)).canUndo).toBe(true);
    await expect.poll(async () => (await state(shell)).items[0]!.placed.x).toBeGreaterThan(300);
    const dropped = (await state(shell)).items[0]!.placed;
    const droppedLeft = await outline.evaluate((node) => (node as HTMLElement).style.left);

    await shell.locator('[data-testid^="layout-reset-"]:not([data-testid^="layout-reset-size-"])').click();
    await expect.poll(async () => (await state(shell)).items[0]!.placed).toMatchObject({ x: 39, y: 32, width: dropped.width, height: dropped.height });
    // The layer follows (its outline is where the item is).
    await expect.poll(() => outline.evaluate((node) => (node as HTMLElement).style.left)).not.toBe(droppedLeft);

    const handle = layer.getByTestId("layout-handle-r");
    const handleBox = (await handle.boundingBox())!;
    await layer.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await layer.mouse.down();
    await layer.mouse.move(handleBox.x + handleBox.width / 2 + 60, handleBox.y + handleBox.height / 2, { steps: 6 });
    await layer.mouse.up();
    await expect.poll(async () => (await state(shell)).items[0]!.placed.width).toBeGreaterThan(first.placed.width);
    await shell.locator('[data-testid^="layout-reset-size-"]').click();
    await expect.poll(async () => (await state(shell)).items[0]!.placed.width).toBe(first.placed.width);

    // The game isn't running: Take picture is off and says why.
    await expect(shell.getByTestId("layout-take-picture")).toBeDisabled();
    await expect(shell.getByTestId("layout-take-picture-hint")).toHaveAttribute("title", "Start the game first.");
    expect((await state(shell)).pictureHint).toBe("start");
    await shell.getByTestId("layout-done").click();
    await expect.poll(() => shell.isClosed()).toBe(true);
  } finally {
    await app.close();
  }
});
