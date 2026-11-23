import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { OVERLAY_FRAME_PARAM } from "@tavora/sdk/protocol";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { desktopDir, inModule, launch, newUserData, openModule, panels, realClick, seedLibrary, typeInModule, waitForShown, type Box } from "./harness";
import { CARD_ROOM } from "../../src/shared/layer-card";
import { STAND_IN_TITLE } from "../../src/main/game-stand-in";

// The in-game layer over a game in front: opened with its key in Use, switched to Arrange and back, and closed. No real
// game is involved, nor any other program: a plain window the test opens in Tavora's own process stands in for the game
// (TAVORA_TEST_GAME_WINDOW, game-stand-in.ts), and the keys are never registered with the system (the test presses them).
// Test runs keep every window invisible, so how the layer looks over a game, and where on the screen, still needs a real one.

const ID = "local.test.layer-test-module";
const MODULES = path.join(desktopDir, "test/in-game");
const KEY = "Ctrl+Alt+F9";
/** The stand-in game window's client area (DIPs). */
const GAME: Box = { x: 40, y: 40, width: 800, height: 600 };

interface Spy {
  keys: Map<string, () => void>;
  /** setIgnoreMouseEvents, focus of a page, hide and showInactive of a window, with when (Date.now()). */
  mouse: { id: number; ignore: boolean; at: number }[];
  focused: { contents: number; at: number }[];
  hidden: { id: number; at: number }[];
  shown: { id: number; url: string; bounds: Box; at: number }[];
}

/**
 * Watches what the main process does with the layer's windows, and takes the keys Tavora registers, so a press is the
 * test's and no key of this PC is taken. Before anything is over the game: keys are registered only while something shows.
 */
async function spy(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, globalShortcut, webContents }) => {
    const seen: Spy = { keys: new Map(), mouse: [], focused: [], hidden: [], shown: [] };
    (globalThis as unknown as { __layerSpy: Spy }).__layerSpy = seen;
    globalShortcut.register = ((accelerator: string, callback: () => void) => (seen.keys.set(accelerator, callback), true)) as typeof globalShortcut.register;
    globalShortcut.unregister = ((accelerator: string) => void seen.keys.delete(accelerator)) as typeof globalShortcut.unregister;
    const windows = BrowserWindow.prototype;
    const { setIgnoreMouseEvents, hide, showInactive } = windows;
    windows.setIgnoreMouseEvents = function (this: Electron.BrowserWindow, ignore: boolean, options?: Electron.IgnoreMouseEventsOptions) {
      seen.mouse.push({ id: this.id, ignore, at: Date.now() });
      return setIgnoreMouseEvents.call(this, ignore, options);
    };
    windows.hide = function (this: Electron.BrowserWindow) {
      seen.hidden.push({ id: this.id, at: Date.now() });
      return hide.call(this);
    };
    windows.showInactive = function (this: Electron.BrowserWindow) {
      seen.shown.push({ id: this.id, url: this.webContents.getURL(), bounds: this.getBounds(), at: Date.now() });
      return showInactive.call(this);
    };
    const pages = Object.getPrototypeOf(webContents.getAllWebContents()[0]!) as Electron.WebContents;
    const { focus } = pages;
    pages.focus = function (this: Electron.WebContents) {
      seen.focused.push({ contents: this.id, at: Date.now() });
      return focus.call(this);
    };
  });
}

/** What the spy saw so far, as plain data (the keys by name); the test picks from it here, not in the main process. */
type Seen = Omit<Spy, "keys"> & { keys: string[] };
async function spied<T>(app: ElectronApplication, read: (seen: Seen) => T): Promise<T> {
  const seen = await app.evaluate(() => {
    const { keys, ...rest } = (globalThis as unknown as { __layerSpy: Spy }).__layerSpy;
    return { ...rest, keys: [...keys.keys()] };
  });
  return read(seen);
}

/** The layer key, as the system would call it. */
async function pressKey(app: ElectronApplication): Promise<void> {
  await expect.poll(() => spied(app, (seen) => seen.keys)).toContain(KEY);
  await app.evaluate((_electron, key) => (globalThis as unknown as { __layerSpy: Spy }).__layerSpy.keys.get(key)!(), KEY);
}

type Host = { tavoraHost: { act(action: unknown): Promise<unknown>; getState(): Promise<{ hotkeyRequest: { id: number } | null; panels: { instanceId: string; moduleId: string }[] }> } };
const hostState = (page: Page) => page.evaluate(() => (window as unknown as Host).tavoraHost.getState());
const act = (page: Page, action: unknown) => page.evaluate((action) => (window as unknown as Host).tavoraHost.act(action), action);

interface Scene {
  /** The panel's window over the game: the panel's view in it, and the arrange frame's view above it. */
  panel: { id: number; visible: boolean; focusable: boolean; bounds: Box; view: { contents: number; bounds: Box }; frame: { contents: number; visible: boolean; bounds: Box; onTop: boolean } } | null;
  /** The panel's live view, with the count it shows. */
  live: { id: number; visible: boolean; count: string | null } | null;
  card: { id: number; visible: boolean; bounds: Box } | null;
  /** The panel's view is in Tavora's window, in its workspace slot. */
  inWorkspace: boolean;
}

async function scene(app: ElectronApplication): Promise<Scene> {
  return app.evaluate(
    async ({ BrowserWindow }, { moduleId, frameParam }) => {
      const result: Scene = { panel: null, live: null, card: null, inWorkspace: false };
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        const url = window.webContents.getURL();
        const children = window.contentView.children as Electron.WebContentsView[];
        const view = children.find((child) => !!child.webContents && !child.webContents.isDestroyed() && child.webContents.getURL().startsWith(`tavora-module://${moduleId}/`));
        if (url.startsWith("tavora-host://app/") && url.includes("/index.html")) result.inWorkspace = !!view;
        else if (url.includes("/layer-card.html")) result.card = { id: window.id, visible: window.isVisible(), bounds: window.getBounds() };
        else if (url.includes(`${frameParam}=1`)) {
          const count = (await window.webContents.executeJavaScript(`document.querySelector('[data-testid="live-count"]')?.textContent ?? null`)) as string | null;
          result.live = { id: window.id, visible: window.isVisible(), count };
        } else if (view) {
          const frame = children.find((child) => child !== view)!;
          result.panel = {
            id: window.id,
            visible: window.isVisible(),
            focusable: window.isFocusable(),
            bounds: window.getBounds(),
            view: { contents: view.webContents.id, bounds: view.getBounds() },
            frame: { contents: frame.webContents.id, visible: frame.getVisible(), bounds: frame.getBounds(), onTop: children.indexOf(frame) > children.indexOf(view) },
          };
        }
      }
      return result;
    },
    { moduleId: ID, frameParam: OVERLAY_FRAME_PARAM },
  );
}

/** The card's page, once its window is there (each opening of the layer makes a new one). */
async function cardPage(app: ElectronApplication): Promise<Page> {
  const find = () => app.windows().find((candidate) => candidate.url().includes("/layer-card.html"));
  await expect.poll(() => find() !== undefined).toBe(true);
  return find()!;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** The card itself in its window: the window has room around it for the shadow and the tooltips. */
const cardIn = (window: Box): Box => ({ x: window.x + CARD_ROOM.side, y: window.y + CARD_ROOM.top, width: window.width - 2 * CARD_ROOM.side, height: window.height - CARD_ROOM.top - CARD_ROOM.below });
const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** Nothing that should stay changes for a few looks (400 ms each): the layer stays open. */
async function staysFor(app: ElectronApplication, ms: number, check: (now: Scene) => void): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    check(await scene(app));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test.skip(process.platform !== "win32", "game overlays are Windows only");

// TEMPORARY: ten copies, to see the spec is steady on CI; removed before review.
for (let run = 1; run <= 10; run++) test(`the in-game layer over a game in front: Use takes clicks, Arrange frames the panel and stays open, and closing leaves the live view current (run ${run})`, async () => {
  const userData = await newUserData();
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), gameOverlays: true }));
  const { app, page } = await launch(userData, [MODULES], { seed: false, env: { TAVORA_TEST_GAME_WINDOW: "poe2" } });
  try {
    await spy(app);
    // The layer key, set as Settings > Overlays sets it.
    await act(page, { type: "set-overlay-key" });
    await expect.poll(async () => (await hostState(page)).hotkeyRequest).not.toBeNull();
    const request = (await hostState(page)).hotkeyRequest!;
    await act(page, { type: "hotkey-answer", id: request.id, choice: "set", accelerator: KEY });

    // The panel, shown in the game; overlays started (they are hidden for now at every start).
    await openModule(page, ID);
    await waitForShown(app, ID);
    await expect.poll(() => inModule<boolean>(app, ID, "window.__layerTest?.ready === true").catch(() => false)).toBe(true);
    await expect(panels(page, ID)).toHaveCount(1);
    const instanceId = (await hostState(page)).panels.find((panel) => panel.moduleId === ID)!.instanceId;
    await act(page, { type: "show-panel-in-game", instanceId });
    await act(page, { type: "set-game-overlays-hidden", hidden: false });

    // The game comes to the front: the panel's live view shows over it, with the layer closed.
    await app.evaluate(({ BrowserWindow }, { title, bounds }) => {
      const window = new BrowserWindow({ show: false, title, useContentSize: true, ...bounds });
      window.setContentBounds(bounds);
    }, { title: STAND_IN_TITLE, bounds: GAME });
    await expect.poll(async () => (await scene(app)).live).toMatchObject({ visible: true, count: "0" });
    const live = (await scene(app)).live!.id;
    expect((await scene(app)).panel).toBeNull();
    expect((await scene(app)).card).toBeNull();

    // 1. The key opens the layer in Use: the panel over the game, no frame, taking clicks.
    const openedAt = await app.evaluate(() => Date.now());
    await pressKey(app);
    await expect.poll(async () => (await scene(app)).panel?.visible).toBe(true);
    const panelWindow = (await scene(app)).panel!.id;
    await expect.poll(() => spied(app, (seen) => seen.mouse.filter((one) => one.id === panelWindow).at(-1)?.ignore)).toBe(false);
    const use = (await scene(app)).panel!;
    expect(use.frame.visible).toBe(false);
    expect(use.focusable).toBe(true);
    expect((await scene(app)).inWorkspace).toBe(false);
    // No flash of the panel's look from its workspace: its window lets clicks through (and is see-through) until the
    // page has drawn after hearing it is over the game.
    const heard = await inModule<{ over: boolean; at: number }[]>(app, ID, "window.__layerTest.heard");
    const over = heard.find((one) => one.over && one.at >= openedAt);
    expect(over).toBeDefined();
    const tookMouse = await spied(app, (seen) => seen.mouse.filter((one) => !one.ignore));
    expect(tookMouse.find((one) => one.id === panelWindow)!.at).toBeGreaterThan(over!.at);
    // A click counts in the panel, and its live view, still on screen behind it, follows.
    await realClick(app, ID, '[data-testid="count-up"]');
    await expect.poll(() => inModule<string>(app, ID, `document.querySelector('[data-testid="count"]').textContent`)).toBe("1");
    await expect.poll(async () => (await scene(app)).live).toMatchObject({ visible: true, count: "1" });

    // 5. The card sits off the panel, from the moment it shows.
    await cardPage(app);
    await expect.poll(async () => (await scene(app)).card?.visible).toBe(true);
    const card = (await scene(app)).card!;
    const cardShown = await spied(app, (seen) => seen.shown);
    const firstShown = cardShown.find((one) => one.id === card.id)!;
    expect(overlaps(cardIn(firstShown.bounds), use.bounds)).toBe(false);
    expect(overlaps(cardIn(card.bounds), use.bounds)).toBe(false);

    // 2. Arrange: the frame lies over the panel, and the layer stays open.
    await (await cardPage(app)).getByTestId("layer-mode-arrange").click();
    await expect.poll(async () => (await scene(app)).panel?.frame.visible).toBe(true);
    const arrange = (await scene(app)).panel!;
    expect(arrange.id).toBe(panelWindow);
    expect(arrange.frame.onTop).toBe(true);
    expect(contains(arrange.frame.bounds, arrange.view.bounds)).toBe(true);
    // The window keeps the keyboard it may have: made unfocusable, it handed the keyboard to another program, which ended the layer.
    expect(arrange.focusable).toBe(true);
    await staysFor(app, 1600, (now) => {
      expect(now.panel?.id).toBe(panelWindow);
      expect(now.panel?.frame.visible).toBe(true);
      expect(now.card?.visible).toBe(true);
      expect(now.live?.visible).toBe(true);
    });
    expect(overlaps(cardIn((await scene(app)).card!.bounds), use.bounds)).toBe(false);

    // 3. Back to Use: no frame, and the keyboard goes to the panel's page.
    const backAt = await app.evaluate(() => Date.now());
    await (await cardPage(app)).getByTestId("layer-mode-use").click();
    await expect.poll(async () => (await scene(app)).panel?.frame.visible).toBe(false);
    await expect.poll(() => spied(app, (seen) => seen.focused)).toEqual(expect.arrayContaining([expect.objectContaining({ contents: use.view.contents })]));
    const focused = await spied(app, (seen) => seen.focused);
    expect(focused.filter((one) => one.at >= backAt && (one.contents === use.view.contents || one.contents === use.frame.contents)).at(-1)?.contents).toBe(use.view.contents);
    await realClick(app, ID, '[data-testid="field"]');
    await typeInModule(app, ID, "typed in game");
    await expect.poll(() => inModule<string>(app, ID, `document.querySelector('[data-testid="field"]').value`)).toBe("typed in game");
    await realClick(app, ID, '[data-testid="count-up"]');
    await expect.poll(async () => (await scene(app)).live?.count).toBe("2");

    // 4. The key closes it: the panel is back in its slot, and the live view shows what changed, never hidden meanwhile.
    await pressKey(app);
    await expect.poll(async () => (await scene(app)).panel).toBeNull();
    const closed = await scene(app);
    expect(closed.card).toBeNull();
    expect(closed.inWorkspace).toBe(true);
    expect(closed.live).toMatchObject({ id: live, visible: true, count: "2" });
    expect(await spied(app, (seen) => seen.hidden)).not.toContainEqual(expect.objectContaining({ id: live }));
  } finally {
    await app.close();
  }
});
