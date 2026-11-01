import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type { ElectronApplication, Page } from "@playwright/test";
import { launch, newUserData, openModule, seedLibrary, shootWindow } from "./harness";
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

test("Reset position and Reset size work from the page, Take picture says why it is off, and the Overlay button leaves with the canvas views", async () => {
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
    await expect(layer.getByTestId("layout-canvas-empty")).toHaveCount(0);
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

    // Reset position and Reset size are buttons of the frame's toolbar.
    await layer.getByTestId("layout-frame-reset").click();
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
    await layer.getByTestId("layout-frame-reset-size").click();
    await expect.poll(async () => (await state(page)).items[0]!.placed.width).toBe(first.placed.width);

    // The game isn't running: Take picture is off and says why.
    // Off, but still hoverable: the tooltip says why.
    const takePicture = page.getByTestId("layout-take-picture");
    await expect(takePicture).toBeDisabled();
    await takePicture.hover();
    await expect(page.locator("[role=tooltip]")).toHaveText("Start the game first.");
    // Undo and redo name their shortcut.
    await page.getByTestId("layout-redo").hover();
    await expect(page.locator("[role=tooltip]")).toHaveText(/^Redo \((Ctrl|Cmd)\+Y\)$/);
    await page.getByTestId("layout-undo").hover();
    await expect(page.locator("[role=tooltip]")).toHaveText(/^Undo \((Ctrl|Cmd)\+Z\)$/);
    expect((await state(page)).pictureHint).toBe("start");

    // The sidebar is on the right until Settings says otherwise, and the Overlay button stays in the header, lit.
    const canvasBox = (await page.getByTestId("layout-canvas").boundingBox())!;
    expect((await page.getByTestId("layout-sources").boundingBox())!.x).toBeGreaterThan(canvasBox.x);
    await expect(page.getByTestId("overlay-open")).toHaveAttribute("aria-pressed", "true");

    // Pressing it again goes back to the workspace, and the views over the canvas go.
    await page.getByTestId("overlay-open").click();
    await expect(page.getByTestId("workspace")).toBeVisible();
    await expect(page.getByTestId("overlay-page")).toHaveCount(0);
    await expect.poll(() => app.windows().some((candidate) => candidate.url().endsWith("#layer"))).toBe(false);
  } finally {
    await app.close();
  }
});

test("Del and the toolbar next to the selected item remove it, hide it on the canvas and open its panel", async () => {
  const userData = await newUserData();
  await seed(userData);
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    // The item's panel runs in the game's workspace, so Settings has a panel to open.
    await openModule(page, "tavora.clock-counter");
    await overlayPage(app, page, GAME);
    await expect.poll(async () => (await state(page))?.items?.length).toBe(1);
    const id: string = (await state(page)).items[0]!.id;
    const send = (message: unknown) => page.evaluate((message) => (window as unknown as Host).tavoraHost.layout.send(message), message);
    const layer = layerOf(app);
    const bar = layer.getByTestId("layout-frame-toolbar");
    const outline = layer.locator('[data-testid^="layout-item-"]').first();
    // Nothing is selected: no toolbar.
    await expect(bar).toHaveCount(0);
    await send({ type: "select", id });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button")).toHaveCount(5);

    // Where the item starts there is no room above it: the toolbar sits below, with a gap.
    const below = { item: (await outline.boundingBox())!, bar: (await bar.boundingBox())! };
    expect(below.bar.y).toBeGreaterThan(below.item.y + below.item.height);
    // Dropped lower down, it sits above.
    await send({ type: "commit", id, rect: { x: 400, y: 600, width: 300, height: 200 } });
    await expect.poll(async () => (await state(page)).items[0]!.placed.y).toBe(600);
    await expect.poll(async () => (await bar.boundingBox())!.y).toBeLessThan((await outline.boundingBox())!.y);
    const above = { item: (await outline.boundingBox())!, bar: (await bar.boundingBox())! };
    expect(above.bar.y + above.bar.height).toBeLessThan(above.item.y);

    // A tooltip names a button.
    await bar.getByTestId("layout-frame-settings").hover();
    await expect(layer.getByRole("tooltip")).toHaveText("Settings");

    // Del leaves a text field alone.
    await page.getByTestId("layout-search").focus();
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await state(page)).items.length).toBe(1);

    // Hide on canvas is the eye of the Sources list.
    await bar.getByTestId("layout-frame-hide").click();
    await expect.poll(async () => (await state(page)).items[0]!.hiddenOnCanvas).toBe(true);
    await expect(outline).toHaveCount(0);
    await send({ type: "canvas-hidden", id, hidden: false });
    await expect(outline).toBeVisible();

    // Settings opens the panel in its dialog right over the Overlay page, which stays where it is, with the frame selected.
    await bar.getByTestId("layout-frame-settings").click();
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    await page.getByTestId("panel-dialog-close").click();
    await expect(page.getByTestId("panel-dialog")).toHaveCount(0);
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    expect((await state(page)).selection).toBe(id);
    // A double-click on the frame does the same.
    const box = (await layer.locator('[data-testid^="layout-item-"]').first().boundingBox())!;
    await layer.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await page.getByTestId("panel-dialog-close").click();
    await expect(page.getByTestId("panel-dialog")).toHaveCount(0);

    // Del on the canvas takes the selected item out of the setup.
    await send({ type: "select", id });
    await expect(bar).toBeVisible();
    await layer.locator("body").press("Delete");
    await expect.poll(async () => (await state(page)).items.length).toBe(0);
    expect((await state(page)).selection).toBeNull();
    await expect(bar).toHaveCount(0);
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
    // No game runs, and nothing was set up: Everywhere, and the dropdown holds only setups that exist.
    await expect.poll(async () => (await state(page))?.gameId).toBe("$everywhere");
    // An empty canvas says what to do instead of staying blank.
    await expect(layerOf(app).getByTestId("layout-canvas-empty")).toHaveText("Add something from the list on the right");
    const view = await state(page);
    expect(view.games.map((game) => game.id)).toEqual(["$everywhere", "$all"]);
    expect(view.sources).toHaveLength(1);
    const todos = view.sources[0]!;
    expect(todos).toMatchObject({ name: "To-Dos", from: "Path of Exile 2", game: "Path of Exile 2", block: "game-only" });
    // A game's panel can't go into Everywhere: it isn't listed at all, and there is no folded section for it.
    await expect(row(page, todos.id)).toHaveCount(0);
    await expect(page.getByTestId("layout-unusable-toggle")).toHaveCount(0);
    await expect(page.getByTestId("layout-pick")).toBeVisible();

    // A search that names it says why in one quiet line; one that names nothing says so.
    await page.getByTestId("layout-search").fill("to-do");
    await expect(page.getByTestId("layout-blocked")).toHaveText("To-Dos: Only for Path of Exile 2");
    await expect(row(page, todos.id)).toHaveCount(0);
    await page.getByTestId("layout-search").fill("zzz");
    await expect(page.getByTestId("layout-empty")).toHaveText("No panels found.");
    await page.getByTestId("layout-search").fill("");

    // The game gets its setup the way a user adds it (the rail's Add overlay); the dropdown then lists it, and the panel can be added there.
    await page.evaluate((workspaceId) => (window as unknown as Host).tavoraHost.act({ type: "add-game-overlay", workspaceId }), GAME);
    await page.getByRole("button", { name: "Overlay for", exact: true }).click();
    await page.getByTestId(`layout-game-option-${GAME}`).click();
    await expect.poll(async () => (await state(page)).gameId).toBe(GAME);
    await row(page, todos.id).getByRole("button").first().click();
    await expect.poll(async () => (await state(page)).items.length).toBe(1);
    expect((await state(page)).selection).toContain(todos.id);
    await expect(page.getByTestId("layout-count")).toHaveText("1 of 8");
    await expect(page.getByTestId("layout-settings")).toContainText("To-Dos");
    // What the setup holds shows a gear and an eye instead of a check mark.
    await expect(row(page, todos.id).getByLabel("Settings of To-Dos")).toBeVisible();
    await expect(row(page, todos.id).getByTestId(/layout-eye-/)).toBeVisible();

    // The rail: Remove overlay for the game takes its setup away, Add overlay brings an empty one back.
    const railMenu = async (workspaceId: string, item: string) => {
      await page.getByTestId(`rail-workspace-${workspaceId}`).click({ button: "right" });
      await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
    };
    await expect(page.getByTestId("rail-workspace-satisfactory")).toBeVisible();
    await railMenu(GAME, "menu-remove-overlay");
    await expect.poll(async () => (await state(page)).games.map((game) => game.id)).toEqual(["$everywhere", "$all"]);
    expect((await state(page)).gameId).toBe("$all");
    await railMenu(GAME, "menu-add-overlay");
    await expect.poll(async () => (await state(page)).games.map((game) => game.id)).toEqual(["$everywhere", "$all", GAME]);
  } finally {
    await app.close();
  }
  const saved = JSON.parse(await readFile(path.join(userData, "game-overlays.json"), "utf8"));
  expect(saved.version).toBe(5);
  expect(saved.setups.map((setup: { id: string }) => setup.id)).toEqual(["$everywhere", "$all", GAME]);
});

test("the sidebar sits where Settings > Overlays puts it", async () => {
  const userData = await newUserData();
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), gameOverlays: true, overlaySidebar: "left" }));
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    await overlayPage(app, page);
    await expect(page.getByTestId("layout-canvas")).toBeVisible();
    const canvasBox = (await page.getByTestId("layout-canvas").boundingBox())!;
    const sidebarBox = (await page.getByTestId("layout-sources").boundingBox())!;
    expect(sidebarBox.x).toBeLessThan(canvasBox.x);
  } finally {
    await app.close();
  }
});

test("Dragging, resizing and the frame toolbar in another preview shape save through the anchored rectangle", async () => {
  const userData = await newUserData();
  await seed(userData);
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    await overlayPage(app, page, GAME);
    await expect.poll(async () => (await state(page))?.items?.length).toBe(1);
    const first = (await state(page)).items[0]!;
    await row(page, first.id).getByRole("button").first().click();
    await expect.poll(async () => (await state(page)).selection).toBe(first.id);
    await page.getByRole("button", { name: "Preview as", exact: true }).click();
    await page.getByTestId("layout-preview-option-32:9").click();
    await expect.poll(async () => (await state(page)).canvas.width).toBe(3840);
    // Only the preview changed: the saved rectangle is the one it was.
    expect((await state(page)).items[0]!.rect).toEqual(first.rect);

    // Drag it to the right end of the wide canvas with the mouse: it is saved anchored to the right edge.
    const layer = layerOf(app);
    const outline = layer.locator('[data-testid^="layout-item-"]').first();
    await expect(outline).toBeVisible();
    const box = (await outline.boundingBox())!;
    const canvasWidth = (await page.getByTestId("layout-canvas").boundingBox())!.width;
    await layer.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await layer.mouse.down();
    await layer.mouse.move(canvasWidth - box.width / 2 - 8, box.y + box.height / 2, { steps: 8 });
    await layer.mouse.up();
    await expect.poll(async () => (await state(page)).items[0]!.rect.h).toBe("right");
    const dragged = (await state(page)).items[0]!;
    expect(dragged.rect.x).toBeLessThan(0.1);
    expect(dragged.rect.width).toBeCloseTo(first.rect.width, 2);
    expect(dragged.placed.x + dragged.placed.width).toBeGreaterThan(3840 - 100);

    // Resize with the handle, then the toolbar's Reset size and Reset position.
    const handle = layer.getByTestId("layout-handle-l");
    const handleBox = (await handle.boundingBox())!;
    await layer.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await layer.mouse.down();
    await layer.mouse.move(handleBox.x + handleBox.width / 2 - 80, handleBox.y + handleBox.height / 2, { steps: 6 });
    await layer.mouse.up();
    await expect.poll(async () => (await state(page)).items[0]!.rect.width).toBeGreaterThan(dragged.rect.width);
    expect((await state(page)).items[0]!.rect.h).toBe("right");
    await layer.getByTestId("layout-frame-reset-size").click();
    await expect.poll(async () => (await state(page)).items[0]!.rect.width).toBeCloseTo(first.rect.width, 2);
    await layer.getByTestId("layout-frame-reset").click();
    await expect.poll(async () => (await state(page)).items[0]!.rect).toMatchObject({ h: "left", v: "top", x: 0.036, y: 0.03 });

    // Back in the real shape the frame is where the saved rectangle puts it.
    await page.getByRole("button", { name: "Preview as", exact: true }).click();
    await page.getByTestId("layout-preview-option-default").click();
    await expect.poll(async () => (await state(page)).canvas.width).toBeLessThan(3840);
    expect((await state(page)).items[0]!.placed).toMatchObject({ x: 39, y: 32 });
  } finally {
    await app.close();
  }
});

/** A plain 1920 x 1080 picture of a "scene" (a sky, a ground and a few blocks), as PNG bytes. */
function scenePng(): Buffer {
  const width = 1920;
  const height = 1080;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const ground = y > height * 0.7;
      const block = (x > 300 && x < 520 && y > 520) || (x > 1300 && x < 1700 && y > 380 && y < 760);
      const [r, g, b] = block ? [90, 100, 130] : ground ? [60, 90, 60] : [40 + (y >> 4), 70 + (y >> 4), 120 + (y >> 4)];
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const crc = (buffer: Buffer) => {
    let c = ~0;
    for (const byte of buffer) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Where a setup's picture is kept (main/layout-pictures.ts: the setup's id, hashed). */
const pictureFile = (userData: string, setupId: string) => path.join(userData, "overlay-pictures", `${createHash("sha256").update(setupId).digest("hex").slice(0, 24)}.png`);

// With TAVORA_SHOTS=<folder> the test also saves screenshots of the page (the native views over the canvas are not in them).
const SHOTS = process.env.TAVORA_SHOTS;
const shot = async (page: Page, name: string) => {
  // The views over the canvas follow a moment after the canvas moves.
  if (SHOTS) {
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  }
};

for (const mode of [
  { name: "en-dark", locale: "en", theme: "dark" },
  { name: "de-light", locale: "de", theme: "light" },
] as const) {
  test(`${mode.name}: every setup can have a picture, and Preview as shows other shapes without moving anything`, async () => {
    const userData = await newUserData();
    await seed(userData, true);
    await mkdir(path.join(userData, "overlay-pictures"), { recursive: true });
    await writeFile(pictureFile(userData, "$all"), scenePng());
    const { app, page } = await launch(userData, [MODULES], { seed: false, locale: mode.locale, systemTheme: mode.theme });
    const en = mode.locale === "en";
    try {
      await overlayPage(app, page, "$all");
      await expect.poll(async () => (await state(page)).picture).not.toBeNull();
      // All games has a picture to choose and remove, but none to take: that needs one game's window.
      await expect(page.getByTestId("layout-picture")).toBeVisible();
      await expect(page.getByTestId("layout-choose-picture")).toBeVisible();
      await expect(page.getByTestId("layout-remove-picture")).toBeVisible();
      await expect(page.getByTestId("layout-take-picture")).toHaveCount(0);
      await expect(page.getByTestId("layout-picture-hint")).toHaveCount(0);
      await shot(page, `01-all-games-picture-${mode.name}`);

      // Everywhere has none yet: a quiet hint says how to add one.
      await page.getByRole("button", { name: en ? "Overlay for" : "Overlay für", exact: true }).click();
      await page.getByTestId("layout-game-option-$everywhere").click();
      await expect.poll(async () => (await state(page)).gameId).toBe("$everywhere");
      await expect(page.getByTestId("layout-picture")).toHaveCount(0);
      await expect(page.getByTestId("layout-picture-hint")).toBeVisible();
      await expect(page.getByTestId("layout-remove-picture")).toHaveCount(0);
      await expect(page.getByTestId("layout-take-picture")).toHaveCount(0);
      await shot(page, `02-hint-everywhere-${mode.name}`);

      // Back to All games, then Preview as.
      await page.getByRole("button", { name: en ? "Overlay for" : "Overlay für", exact: true }).click();
      await page.getByTestId("layout-game-option-$all").click();
      await expect.poll(async () => (await state(page)).gameId).toBe("$all");
      const before = (await state(page)).items.map((item) => item.rect);
      expect(before.length).toBeGreaterThan(0);
      const ratioOf = async () => {
        const box = (await page.getByTestId("layout-canvas").boundingBox())!;
        return box.width / box.height;
      };
      // The canvas starts in the shape of the main screen, whatever shape that is on this PC.
      const own = (await state(page)).canvas;
      expect(await ratioOf()).toBeCloseTo(own.width / own.height, 1);
      await page.getByRole("button", { name: en ? "Preview as" : "Vorschau als", exact: true }).click();
      await expect(page.getByTestId("layout-preview-option-default")).toContainText(en ? /^This screen · \d+(:\d+|\.\d+:1)$/ : /^Dieser Bildschirm · /);
      for (const ratio of ["16:9", "16:10", "21:9", "32:9"]) await expect(page.getByTestId(`layout-preview-option-${ratio}`)).toHaveText(ratio);
      await expect(page.locator('[data-testid^="layout-preview-option-monitor:"]').first()).toContainText(/^Monitor 1 · \d+×\d+$/);
      await shot(page, `03-preview-picker-${mode.name}`);
      await page.getByTestId("layout-preview-option-21:9").click();
      await expect.poll(ratioOf).toBeCloseTo(21 / 9, 1);
      await shot(page, `04-preview-21x9-${mode.name}`);
      await page.getByRole("button", { name: en ? "Preview as" : "Vorschau als", exact: true }).click();
      await page.getByTestId("layout-preview-option-32:9").click();
      await expect.poll(ratioOf).toBeCloseTo(32 / 9, 1);
      await shot(page, `05-preview-32x9-${mode.name}`);
      // The layer over the canvas follows the new shape: the frame sits where the canvas puts it (a left, top frame stays in the corner).
      const outline = layerOf(app).locator('[data-testid^="layout-item-"]').first();
      await expect(outline).toBeVisible();
      // The layer's own page starts at the canvas's corner, so the frame's left edge is its distance from it.
      await expect.poll(async () => (await outline.boundingBox())!.x / (await page.getByTestId("layout-canvas").boundingBox())!.width).toBeCloseTo(39 / 3840, 2);
      // Only the preview changed: the picture is letterboxed, and the saved positions are what they were.
      await expect(page.getByTestId("layout-picture")).toHaveClass(/object-contain/);
      expect((await state(page)).items.map((item) => item.rect)).toEqual(before);

      // The choice is kept for the setup while the app runs; the other setup still has its own.
      await page.getByRole("button", { name: en ? "Overlay for" : "Overlay für", exact: true }).click();
      await page.getByTestId("layout-game-option-$everywhere").click();
      await expect.poll(async () => (await state(page)).gameId).toBe("$everywhere");
      expect((await state(page)).preview.choice).toBe("default");
      await page.getByRole("button", { name: en ? "Overlay for" : "Overlay für", exact: true }).click();
      await page.getByTestId("layout-game-option-$all").click();
      await expect.poll(async () => (await state(page)).preview.choice).toBe("32:9");

      // Remove picture takes the file away and brings the hint back.
      await page.getByTestId("layout-remove-picture").click();
      await expect.poll(async () => (await state(page)).picture).toBeNull();
      await expect(page.getByTestId("layout-picture-hint")).toBeVisible();
      await expect(access(pictureFile(userData, "$all"))).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
}

/** A library with a third game, Valheim, that has no overlay setup, and setups for the two others. */
const PERSONAL = "local-notes";
async function seedCopy(userData: string) {
  await mkdir(userData, { recursive: true });
  const library = seedLibrary();
  (library.workspaces as Record<string, unknown>).valheim = { ...library.workspaces.satisfactory, id: "valheim", catalogId: "valheim", name: "Valheim" };
  // Items from a personal workspace can go into any game's setup.
  (library.workspaces as Record<string, unknown>)[PERSONAL] = { ...library.workspaces.satisfactory, id: PERSONAL, kind: "personal", catalogId: null, name: "Notes", lastOpenedAt: null };
  library.root.push({ kind: "workspace", id: "valheim" }, { kind: "workspace", id: PERSONAL });
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...library, gameOverlays: true }));
  const clock = (key: string, workspaceId: string, extra: Record<string, unknown> = {}) => ({
    owner: "official",
    moduleId: "tavora.clock-counter",
    workspaceId,
    key,
    mode: "always",
    opacity: 100,
    hideFromCapture: false,
    anchor: { h: "left", v: "top", x: 0.036, y: 0.03, width: 0.2, height: 0.16 },
    ...extra,
  });
  const setups = [
    { id: "$everywhere", overlays: [], panels: [] },
    { id: "$all", overlays: [], panels: [] },
    // The first only works in Path of Exile 2; the second has its own place and settings.
    { id: GAME, overlays: [clock("own", GAME), clock("shared", PERSONAL, { mode: "toggle", opacity: 50, hideFromCapture: true, anchor: { h: "right", v: "bottom", x: 0.05, y: 0.1, width: 0.25, height: 0.2 } }), clock("extra", PERSONAL)], panels: [] },
    { id: "satisfactory", overlays: [clock("mine", "satisfactory"), clock("other", PERSONAL)], panels: [] },
  ];
  await writeFile(path.join(userData, "game-overlays.json"), JSON.stringify({ version: 5, setups, layout: { seen: {} } }));
}

const keysOf = async (page: Page, setup: string) => {
  await page.getByRole("button", { name: "Overlay for", exact: true }).click();
  await page.getByTestId(`layout-game-option-${setup}`).click();
  await expect.poll(async () => (await state(page)).gameId).toBe(setup);
  return (await state(page)).items.map((item) => item.id.split("\n").at(-1));
};

test("Copy to… lists the other games, copies right away to one without frames, asks before touching one that has some, and says what it left out", async () => {
  const userData = await newUserData();
  await seedCopy(userData);
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    await overlayPage(app, page, GAME);
    await expect.poll(async () => (await state(page))?.items.length).toBe(3);
    const copy = page.getByTestId("layout-copy");
    await expect(copy).toBeEnabled();

    // The current game is not listed; the others are, with how many frames each has.
    await copy.click();
    await expect(page.getByTestId("layout-copy-menu").getByRole("menuitem")).toHaveText(["Satisfactory2 frames", "ValheimNo frames"]);
    await page.getByTestId("layout-copy-option-valheim").click();

    // Valheim has none: copied at once, and the note says what could not go.
    await expect(page.getByTestId("layout-copied")).toContainText("Copied 2 frames to Valheim. 1 frame only works in Path of Exile 2.");
    await expect(page.getByTestId("layout-copy-dialog")).toHaveCount(0);
    expect((await state(page)).gameId).toBe(GAME);
    await page.getByTestId("layout-copied-show").click();
    await expect.poll(async () => (await state(page)).gameId).toBe("valheim");
    await expect(page.getByTestId("layout-copied")).toHaveCount(0);
    const shown = await state(page);
    expect(shown.items.map((item) => item.id.split("\n").at(-1))).toEqual(["shared", "extra"]);
    // Place and settings came along.
    expect(shown.items[0]).toMatchObject({ mode: "toggle", opacity: 50, hideFromCapture: true, rect: { h: "right", v: "bottom", x: 0.05, y: 0.1, width: 0.25, height: 0.2 } });

    // Satisfactory has two: a dialog asks. Cancel changes nothing.
    await page.getByRole("button", { name: "Overlay for", exact: true }).click();
    await page.getByTestId(`layout-game-option-${GAME}`).click();
    await expect.poll(async () => (await state(page)).gameId).toBe(GAME);
    await page.getByTestId("layout-copy").click();
    await page.getByTestId("layout-copy-option-satisfactory").click();
    const dialog = page.getByTestId("layout-copy-dialog");
    await expect(dialog).toContainText("Satisfactory already has 2 frames");
    await page.getByTestId("layout-copy-cancel").click();
    await expect(dialog).toHaveCount(0);
    expect(await keysOf(page, "satisfactory")).toEqual(["mine", "other"]);

    // Add to them: its own stay, the copies come after.
    await page.getByRole("button", { name: "Overlay for", exact: true }).click();
    await page.getByTestId(`layout-game-option-${GAME}`).click();
    await expect.poll(async () => (await state(page)).gameId).toBe(GAME);
    await page.getByTestId("layout-copy").click();
    await page.getByTestId("layout-copy-option-satisfactory").click();
    await page.getByTestId("layout-copy-add").click();
    await expect(page.getByTestId("layout-copied")).toContainText("Copied 2 frames to Satisfactory. 1 frame only works in Path of Exile 2.");
    expect(await keysOf(page, "satisfactory")).toEqual(["mine", "other", "shared", "extra"]);

    // Replace them: only the copies are left.
    await page.getByRole("button", { name: "Overlay for", exact: true }).click();
    await page.getByTestId(`layout-game-option-${GAME}`).click();
    await page.getByTestId("layout-copy").click();
    await page.getByTestId("layout-copy-option-satisfactory").click();
    await page.getByTestId("layout-copy-replace").click();
    await expect(page.getByTestId("layout-copied")).toBeVisible();
    expect(await keysOf(page, "satisfactory")).toEqual(["shared", "extra"]);
  } finally {
    await app.close();
  }
  const saved = JSON.parse(await readFile(path.join(userData, "game-overlays.json"), "utf8"));
  const ids = (setup: string) => saved.setups.find((item: { id: string }) => item.id === setup).overlays.map((overlay: { key: string }) => overlay.key);
  expect(ids("valheim")).toEqual(["shared", "extra"]);
  expect(ids("satisfactory")).toEqual(["shared", "extra"]);
  expect(ids(GAME)).toEqual(["own", "shared", "extra"]);
});

test("Copy to… is off with a reason while the setup is empty", async () => {
  const userData = await newUserData();
  await seedCopy(userData);
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    await overlayPage(app, page, "$everywhere");
    await expect(page.getByTestId("layout-copy")).toBeDisabled();
    await expect(page.getByTestId("layout-copy-hint")).toHaveAttribute("title", "Add a frame first.");
  } finally {
    await app.close();
  }
});
for (const mode of [
  { name: "en-dark", locale: "en", theme: "dark", sidebar: "right" },
  { name: "de-light", locale: "de", theme: "light", sidebar: "left" },
] as const) {
  test(`${mode.name}: several frames are selected with Shift or a box, Del removes them all, and undo brings them back exactly`, async () => {
    const userData = await newUserData();
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), gameOverlays: true, overlaySidebar: mode.sidebar }));
    // Three frames apart from each other on a 1920 x 1080 window; the last one half see-through.
    const overlay = (key: string, x: number, y: number, opacity: number) => ({
      owner: "official",
      moduleId: "tavora.clock-counter",
      workspaceId: GAME,
      key,
      scope: "game",
      mode: "always",
      opacity,
      hideFromCapture: false,
      rect: { x: 0, y: 0, width: 0.2, height: 0.16 },
      anchor: { h: "left", v: "top", x, y, width: 0.356, height: 0.16 },
    });
    const overlays = [overlay("a", 0.036, 0.03, 100), overlay("b", 0.6, 0.3, 100), overlay("c", 1.2, 0.6, 50)];
    await writeFile(path.join(userData, "game-overlays.json"), JSON.stringify({ version: 4, overlays, panels: [], layout: { seen: { [GAME]: { width: 1920, height: 1080 } }, games: {} } }));
    const { app, page } = await launch(userData, [MODULES], { seed: false, locale: mode.locale, systemTheme: mode.theme });
    const en = mode.locale === "en";
    const picture = async (name: string) => {
      if (!SHOTS) return;
      await page.waitForTimeout(800);
      await shootWindow(app, page, path.join(SHOTS, `${name}-${mode.name}.png`));
    };
    try {
      await overlayPage(app, page, GAME);
      await expect.poll(async () => (await state(page))?.items?.length).toBe(3);
      const before = (await state(page)).items.map(({ id, placed, rect, opacity }) => ({ id, placed, rect, opacity }));
      const layer = layerOf(app);
      const frames = layer.locator('[data-testid^="layout-item-"]');
      await expect(frames).toHaveCount(3);
      const bar = layer.getByTestId("layout-frame-toolbar");

      // A click selects one, Shift and a click adds another.
      await frames.nth(1).click();
      await expect.poll(async () => (await state(page)).selected).toEqual([before[1]!.id]);
      await frames.nth(2).click({ modifiers: ["Shift"] });
      await expect.poll(async () => (await state(page)).selected).toEqual([before[1]!.id, before[2]!.id]);
      // The toolbar has only what works on several, and the Settings box says how many, with Opacity mixed.
      await expect(bar.getByRole("button")).toHaveCount(4);
      await expect(bar.getByTestId("layout-frame-settings")).toHaveCount(0);
      await expect(page.getByTestId("layout-selected-many")).toHaveText(en ? "2 frames selected" : "2 Rahmen ausgewählt");
      await expect(page.getByTestId("layout-opacity-many")).toContainText(en ? "Mixed" : "Gemischt");
      await expect(page.getByTestId("layout-mixed-mode")).toHaveCount(0);
      await picture("01-two-selected");

      // A second Shift and click takes it out again.
      await frames.nth(2).click({ modifiers: ["Shift"] });
      await expect.poll(async () => (await state(page)).selected).toEqual([before[1]!.id]);

      // A box drawn over the empty canvas selects every frame it touches.
      const area = (await layer.locator(".canvas-layer").boundingBox())!;
      await layer.mouse.move(area.x + area.width - 4, area.y + area.height - 4);
      await layer.mouse.down();
      await layer.mouse.move(area.x + 4, area.y + 4, { steps: 8 });
      await expect(layer.getByTestId("layout-band")).toBeVisible();
      await layer.mouse.up();
      await expect.poll(async () => (await state(page)).selected).toEqual(before.map((item) => item.id));
      await expect(page.getByTestId("layout-selected-many")).toHaveText(en ? "3 frames selected" : "3 Rahmen ausgewählt");
      await picture("02-box-selected");

      // Del removes all three as one step; the empty canvas names the side the list is on.
      await layer.locator("body").press("Delete");
      await expect.poll(async () => (await state(page)).items.length).toBe(0);
      await expect(layer.getByTestId("layout-canvas-empty")).toHaveText(
        en ? "Add something from the list on the right" : "Füg etwas aus der Liste links hinzu",
      );
      await picture("03-empty-hint");

      // Ctrl+Z brings them back exactly, selected; Ctrl+Y removes them again, and Ctrl+Z once more brings them back.
      await layer.locator("body").press("Control+z");
      await expect.poll(async () => (await state(page)).items.length).toBe(3);
      expect((await state(page)).items.map(({ id, placed, rect, opacity }) => ({ id, placed, rect, opacity }))).toEqual(before);
      expect((await state(page)).selected).toEqual(before.map((item) => item.id));
      await layer.locator("body").press("Control+y");
      await expect.poll(async () => (await state(page)).items.length).toBe(0);
      await page.locator("body").press("Control+z");
      await expect.poll(async () => (await state(page)).items.length).toBe(3);

      // Esc lets go of the selection.
      await layer.locator("body").press("Escape");
      await expect.poll(async () => (await state(page)).selected).toEqual([]);
    } finally {
      await app.close();
    }
  });
}
