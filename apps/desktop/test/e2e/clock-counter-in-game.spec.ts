import { expect, test } from "@playwright/test";
import { PROTOCOL_VERSION } from "@tavora/sdk/protocol";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { inModule, launch, newUserData, openModule, seedLibrary, waitForShown } from "./harness";
import type { LayoutView } from "../../src/shared/layout-view";
import { insert, newItem, startPause, type Clock, type Counter, type ItemList } from "../../../../modules/clock-counter/src/items";
import { buildLiveState } from "../../../../modules/clock-counter/src/live";

// Clock & Counter can be shown over the game: the Overlay page lists its panel as one that can be added, the panel does its
// work (counting, Start and Reset, Add) without the calls Tavora refuses for a panel over the game, says what to do when
// one of its buttons is refused, and its live view draws every clock and counter. No test here has a running game: the
// layer over a real game window is not reachable from the test app.

const MODULES = path.resolve("../../modules");
const DIST = path.join(MODULES, "clock-counter/dist");
const ID = "tavora.clock-counter";
/** Where a run keeps the pictures it takes (the pull request's screenshots); no pictures without it. */
const SHOTS = process.env.CC_SHOTS;

type Host = { tavoraHost: { act(action: unknown): Promise<unknown>; layout: { getState(): Promise<LayoutView> } } };

const state = (page: Page) => page.evaluate(() => (window as unknown as Host).tavoraHost.layout.getState());
const row = (page: Page, id: string) => page.getByTestId(`layout-source-${id}`);

async function overlayPage(app: ElectronApplication, page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as Host).tavoraHost.act({ type: "open-overlay-page" }));
  await expect(page.getByTestId("overlay-page")).toBeVisible();
  await expect.poll(() => app.windows().some((candidate) => candidate.url().endsWith("#layer"))).toBe(true);
}

/** Runs `script` in the panel once the element is there; a page that is still loading counts as not there yet. */
async function inPanel<T = unknown>(app: ElectronApplication, testId: string, script: string): Promise<T> {
  await expect.poll(() => inModule<boolean>(app, ID, `!!document.querySelector('[data-testid="${testId}"]')`).catch(() => false)).toBe(true);
  return inModule<T>(app, ID, script);
}
const click = (app: ElectronApplication, testId: string) => inPanel(app, testId, `document.querySelector('[data-testid="${testId}"]').click()`);
const text = (app: ElectronApplication, testId: string) => inPanel<string>(app, testId, `document.querySelector('[data-testid="${testId}"]').textContent.trim()`);
const attribute = (app: ElectronApplication, testId: string, name: string) => inPanel<string>(app, testId, `document.querySelector('[data-testid="${testId}"]').getAttribute("${name}")`);

/** The panel's own page as a picture: the module is a view of its own, so a screenshot of the window leaves it out. */
async function shotOfPanel(app: ElectronApplication, name: string): Promise<void> {
  if (!SHOTS) return;
  // A picture only: let the panel finish drawing (a fade, a resize) before it is taken. Nothing is asserted here.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const png = await app.evaluate(async ({ webContents }, moduleId) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
    if (!target) throw new Error("no panel");
    return (await target.capturePage()).toPNG().toString("base64");
  }, ID);
  await writeFile(path.join(SHOTS, name), Buffer.from(png, "base64"));
}

/** Closes the settings dialog with its ×: the settings have no Done button, they save at once. */
async function closeSettings(page: Page): Promise<void> {
  await page.getByTestId("panel-dialog-close").click();
  await expect(page.getByTestId("panel-dialog")).toHaveCount(0);
}

async function inPersonalWorkspace(): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = await newUserData();
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), gameOverlays: true }));
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  await page.getByTestId("rail-add-personal").click();
  await page.getByTestId("personal-name").fill("Personal");
  await page.getByTestId("create-personal").click();
  await expect(page.getByTestId("rail-workspace-local-personal")).toHaveAttribute("aria-current", "page");
  await openModule(page, ID);
  await waitForShown(app, ID);
  return { app, page };
}

test("the Overlay page lists a Clock & Counter's things under its panel, adds them one by one at the size they need, and opens their settings over the page", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    await click(app, "add-counter");
    await closeSettings(page);
    await click(app, "add");
    await click(app, "pick-stopwatch");
    await expect.poll(() => inModule<number>(app, ID, `document.querySelectorAll('article[data-testid^="item-"]').length`)).toBe(2);
    await overlayPage(app, page);
    // The panel says what it can show, so it is a header with its things under it, not something to add as a whole.
    await expect.poll(async () => (await state(page)).sources[0]?.children?.length).toBe(2);
    const header = (await state(page)).sources[0]!;
    expect(header).toMatchObject({ name: "Clock & Counter", from: "Personal", moduleId: ID, block: null });
    await expect(page.getByTestId("layout-unusable-toggle")).toHaveCount(0);
    await expect(row(page, header.id)).toBeVisible();
    await expect(row(page, header.id).getByTestId(/layout-gear-/)).toHaveCount(0);
    const rowIds = () => page.locator('[data-testid^="layout-source-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
    const before = await rowIds();
    expect(before).toHaveLength(3);
    // Clicking the header folds it; it adds nothing.
    await row(page, header.id).getByRole("button").first().click();
    await expect(page.locator('[data-testid^="layout-source-"]')).toHaveCount(1);
    await row(page, header.id).getByRole("button").first().click();
    expect(await rowIds()).toEqual(before);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sources-addable.png") });

    // The second thing goes in: its row stays where it was, and it gets a gear and an eye in place of the +.
    const second = header.children![1]!;
    await page.getByTestId(`layout-source-${header.id}:${second.key}`).getByRole("button").first().click();
    await expect.poll(async () => (await state(page)).items.length).toBe(1);
    expect(await rowIds()).toEqual(before);
    const item = (await state(page)).items[0]!;
    expect(item.name).toBe(second.name);
    expect((await state(page)).selection).toBe(item.id);
    // Not the big frame a panel starts with: the size its content needs.
    expect(item.placed.width).toBeLessThan(420);
    expect(item.placed.height).toBeLessThan(130);
    await expect(page.getByTestId("layout-count")).toHaveText("1 of 8");
    await expect(page.getByTestId("layout-settings")).toContainText(second.name);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sources-added.png") });

    // Settings, from the row's gear: the panel's dialog over the Overlay page, which stays where it is.
    await page.getByTestId(`layout-gear-${item.id}`).click();
    // Whatever the dialog shows from the first moment is the settings or their placeholder, never the panel's list or an empty page.
    const shown = inModule<string[]>(
      app,
      ID,
      `new Promise((resolve) => {
        const seen = new Set();
        const sample = () => seen.add(document.querySelector('[data-testid^="editor-"]') ? "editor" : document.querySelector('[data-testid="settings-skeleton"]') ? "placeholder" : document.querySelector('[data-testid="clock-counter-app"]') ? "list" : "nothing");
        const timer = setInterval(sample, 10);
        setTimeout(() => (clearInterval(timer), resolve([...seen])), 1500);
      })`,
    );
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    await expect.poll(() => inModule<boolean>(app, ID, `!!document.querySelector('[data-testid^="editor-"]')`).catch(() => false)).toBe(true);
    // The frame names the item, not the module.
    await expect(page.getByTestId("panel-dialog").getByRole("heading").first()).toHaveText(second.name);
    // From a frame of the Overlay page the settings open on what the overlay says.
    await expect.poll(() => attribute(app, "page-text", "aria-current")).toBe("page");
    await shotOfPanel(app, "settings-from-overlay-page.png");
    const states = await shown;
    expect(states).toContain("editor");
    expect(states).not.toContain("list");
    expect(states).not.toContain("nothing");
    await page.getByTestId("panel-dialog-close").click();
    await expect(page.getByTestId("panel-dialog")).toHaveCount(0);
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    expect((await state(page)).selection).toBe(item.id);
  } finally {
    await app.close();
  }
});

test("counting, Start and Reset work, and Add is a menu in the page rather than one Tavora draws", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    await click(app, "add-counter");
    // A new item opens its settings (a dialog over the workspace); closing it goes back to the list.
    await closeSettings(page);
    await click(app, "up");
    await click(app, "up");
    await expect.poll(() => text(app, "value")).toBe("2");
    await click(app, "reset");
    await expect.poll(() => text(app, "value")).toBe("0");

    // ui.showMenu is refused for a panel over the game; Add's choices sit in the page instead.
    await click(app, "add");
    await click(app, "pick-stopwatch");
    await expect.poll(() => inModule<number>(app, ID, `document.querySelectorAll('article[data-testid^="item-"]').length`)).toBe(2);
    await click(app, "start-pause");
    await expect.poll(() => attribute(app, "start-pause", "aria-label")).toBe("Pause");
    await click(app, "start-pause");
    await expect.poll(() => attribute(app, "start-pause", "aria-label")).toBe("Start");
  } finally {
    await app.close();
  }
});

test("an item's settings use Tavora's settings layout: the panel, the overlay and the stream link, each in its own place", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    await click(app, "add-counter");
    const frame = page.getByTestId("panel-dialog");
    await expect(frame).toBeVisible();
    // The frame names the item.
    await expect(frame.getByRole("heading").first()).toHaveText("Counter");

    const texts = (selector: string) => inModule<string[]>(app, ID, `[...document.querySelectorAll(${JSON.stringify(selector)})].map((node) => node.textContent.trim())`);
    // The module's own pages first, then Overlays under a divider: how it looks (Text, Look), then where it shows (In game, On stream).
    // Opened from the panel it starts on the item's own page.
    await expect.poll(() => texts('[data-slot="nav-group"] h3')).toEqual(["Overlays"]);
    await expect.poll(() => texts('[data-slot="nav-divider"]')).toEqual(["Overlays"]);
    await expect.poll(() => texts('[data-slot="nav-list"] button')).toEqual(["Counter", "Hotkeys", "Text", "Look", "In game", "On stream"]);
    // The dots: the overlay is not over a game and Stream overlays are not allowed yet, so both are hollow.
    await expect.poll(() => inModule<string[]>(app, ID, `[...document.querySelectorAll('[data-nav-item] [data-status]')].map((node) => node.getAttribute("data-status"))`)).toEqual(["off", "off"]);
    await expect.poll(() => attribute(app, "page-item", "aria-current")).toBe("page");
    // No Done and no Delete: saving is automatic, closing is the ×, and deleting is a button on the item's row.
    expect(await texts("footer button")).toEqual(["Reset this page"]);
    const everything = () => inModule<string>(app, ID, `document.body.innerText`);
    expect(await everything()).not.toContain("Done");
    await shotOfPanel(app, "settings-counter.png");

    for (const id of ["page-hotkeys", "page-text", "page-look", "page-game", "page-stream", "page-item"]) {
      await click(app, id);
      await expect.poll(() => attribute(app, id, "aria-current")).toBe("page");
    }
    // Hotkeys, In game and On stream have nothing to reset.
    await click(app, "page-hotkeys");
    await expect.poll(() => texts("footer button")).toEqual([]);

    // Overlay text: a free text with {count}; the preview is the real overlay.
    await click(app, "page-text");
    await expect.poll(() => text(app, "overlay-preview")).toBe("Counter 0");
    await inModule(
      app,
      ID,
      `(async () => {
        const field = document.querySelector('[data-testid="overlay-text"]');
        field.focus();
        field.value = "Deaths: {count}";
        field.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      })()`,
    );
    await expect.poll(() => text(app, "overlay-preview")).toBe("Deaths: 0");
    await click(app, "idea-3");
    await expect.poll(() => text(app, "overlay-preview")).toBe("0 kills");
    await shotOfPanel(app, "settings-text.png");

    // Look: font, alignment and outline for everything, then Words and Number, one under the other.
    await click(app, "page-look");
    await expect.poll(() => texts('[data-slot="settings-section"] h3')).toEqual(["Everything", "Words", "Number"]);
    // Words and Number have the same sizes, the kit's: XS S M L XL.
    const sizes = (kind: string) => texts(`[data-testid^="${kind}-size-"]`);
    expect(await sizes("words")).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(await sizes("number")).toEqual(["XS", "S", "M", "L", "XL"]);
    await click(app, "number-size-xl");
    await inModule(app, ID, `document.querySelector('[data-slot="settings-page"] > div').scrollTo(0, 9999)`);
    await shotOfPanel(app, "settings-look.png");

    // Where it shows: over the game (set on the Overlay page) and on stream (the OBS link).
    await click(app, "page-game");
    await expect.poll(() => everything()).toContain("Not over your game");
    await shotOfPanel(app, "settings-in-game.png");
    await click(app, "page-stream");
    await expect.poll(() => everything()).toContain("Copy OBS link");
    await shotOfPanel(app, "settings-on-stream.png");

    // A new label shows in the frame as soon as it is saved (Enter saves a field, as leaving it does).
    await click(app, "page-item");
    await inModule(
      app,
      ID,
      `(async () => {
        const field = document.querySelector('input[id$="-label"]');
        field.value = "Boss";
        field.dispatchEvent(new Event("input", { bubbles: true }));
        // The field hands its text to the page on the next tick.
        await new Promise((resolve) => setTimeout(resolve, 50));
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      })()`,
    );
    await expect(frame.getByRole("heading").first()).toHaveText("Boss · Counter");

    // Delete is not in the settings: it is in the menu of the item's row in the list.
    expect(await everything()).not.toContain("Delete");
    await closeSettings(page);
    // The ··· button opens the row's menu; Delete deletes at once and Undo brings the item back.
    const more = `document.querySelector('[data-testid^="more-"]')`;
    await expect.poll(() => inModule<string>(app, ID, `${more}.title`)).toBe("More for Boss");
    await inModule(app, ID, `${more}.click()`);
    await expect.poll(() => inModule<string>(app, ID, `document.querySelector('[data-testid^="delete-"]').textContent.trim()`)).toBe("DeleteDel");
    await inModule(app, ID, `document.querySelector('[data-testid^="delete-"]').click()`);
    await expect.poll(() => inModule<number>(app, ID, `document.querySelectorAll('article[data-testid^="item-"]').length`)).toBe(0);
    await click(app, "undo");
    await expect.poll(() => inModule<number>(app, ID, `document.querySelectorAll('article[data-testid^="item-"]').length`)).toBe(1);
  } finally {
    await app.close();
  }
});

test("the Format field suggests formats from its own list and keeps what is typed", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    await click(app, "add-countdown");
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await click(app, "page-item");
    // The chevron opens the list from the field's left edge, as wide as the field, in the fixed order with an example each.
    await click(app, "format-presets");
    await expect.poll(() => inModule<string[]>(app, ID, `[...document.querySelectorAll('[data-slot="combobox-item"]')].map((node) => node.textContent.trim())`)).toEqual([
      "s · 14709",
      "m:ss · 245:09",
      "mm:ss · 245:09",
      "h:mm:ss · 4:05:09",
      "hh:mm:ss · 04:05:09",
    ]);
    // Once it has grown into place (it opens from the field), it starts at the field's left edge and is as wide as the field.
    const edges = () =>
      inModule<{ left: number; width: number }>(
        app,
        ID,
        `(() => { const list = document.querySelector('[data-slot="combobox-list"]').getBoundingClientRect(); const field = document.querySelector('[data-slot="combobox-anchor"]').getBoundingClientRect(); return { left: Math.round(list.left - field.left), width: Math.round(list.width - field.width) }; })()`,
      );
    await expect.poll(edges).toEqual({ left: 0, width: 0 });
    await shotOfPanel(app, "settings-format-list.png");
    // The preset that is picked already, pressed again, changes nothing (it must not save "undefined").
    const field = () => inModule<string>(app, ID, `document.querySelector('[data-testid="format-field"]').value`);
    await click(app, "format-m:ss");
    await expect.poll(field).toBe("m:ss");
    await click(app, "format-presets");
    await expect.poll(edges).toEqual({ left: 0, width: 0 });
    await click(app, "format-hh:mm:ss");
    await expect.poll(field).toBe("hh:mm:ss");

    // Typed text is the format: Enter keeps it (it does not pick the first suggestion).
    await inModule(
      app,
      ID,
      `(async () => {
        const field = document.querySelector('[data-testid="format-field"]');
        field.focus();
        field.value = 'm "min"';
        field.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      })()`,
    );
    await expect.poll(() => inModule<string>(app, ID, `document.querySelector('[data-testid="format-field"]').value`)).toBe('m "min"');
    await page.getByTestId("panel-dialog-close").click();
    await expect.poll(() => text(app, "value")).toBe("5 min");
  } finally {
    await app.close();
  }
});

test("rows change places with Alt and the arrows, and Add keeps the new one last", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    await click(app, "add-counter");
    await closeSettings(page);
    await click(app, "add");
    await click(app, "pick-stopwatch");
    const names = () => inModule<string[]>(app, ID, `[...document.querySelectorAll('[data-testid="item-name"] h2')].map((node) => node.textContent.trim())`);
    await expect.poll(names).toEqual(["Counter", "Stopwatch"]);
    const press = (key: string) =>
      inModule(app, ID, `document.querySelector('[data-testid="start-pause"]').dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, altKey: true, bubbles: true, cancelable: true }))`);
    await press("ArrowUp");
    await expect.poll(names).toEqual(["Stopwatch", "Counter"]);
    await press("ArrowDown");
    await expect.poll(names).toEqual(["Counter", "Stopwatch"]);
  } finally {
    await app.close();
  }
});

/** Adds three clocks and counters and names their rows, in the order they were added. */
async function threeRows(app: ElectronApplication, page: Page): Promise<void> {
  await click(app, "add-counter");
  await closeSettings(page);
  await click(app, "add");
  await click(app, "pick-stopwatch");
  await click(app, "add");
  await click(app, "pick-countdown");
  await expect.poll(() => names(app)).toEqual(["Counter", "Stopwatch", "Countdown"]);
}
const names = (app: ElectronApplication) => inModule<string[]>(app, ID, `[...document.querySelectorAll('[data-testid="item-name"] h2')].map((node) => node.textContent.trim())`);

test("a row's ··· menu moves it up and down (off at the ends), and a right-click opens the same menu next to the row", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    await threeRows(app, page);
    const menuOf = (index: number) => `document.querySelectorAll('[data-testid^="more-"]')[${index}]`;
    // The first row can't go up; the last can't go down.
    await inModule(app, ID, `${menuOf(0)}.click()`);
    await expect.poll(() => inModule<string[]>(app, ID, `[...document.querySelectorAll('[role=menuitem]')].map((item) => item.textContent.trim() + (item.hasAttribute("data-disabled") ? " (off)" : ""))`)).toEqual([
      "Settings…",
      "Move up (off)",
      "Move down",
      "DeleteDel",
    ]);
    await inModule(app, ID, `document.querySelector('[data-testid^="menu-down-"]').click()`);
    await expect.poll(() => names(app)).toEqual(["Stopwatch", "Counter", "Countdown"]);
    // The focus comes back to the row's button, so the menu can be opened again from the keyboard.
    await expect.poll(() => inModule<string>(app, ID, `document.activeElement?.getAttribute("data-testid") ?? ""`)).toMatch(/^more-/);
    await inModule(app, ID, `${menuOf(2)}.click()`);
    await expect.poll(() => inModule<boolean>(app, ID, `document.querySelector('[data-testid^="menu-down-"]').hasAttribute("data-disabled")`)).toBe(true);
    await inModule(app, ID, `document.querySelector('[data-testid^="menu-up-"]').click()`);
    await expect.poll(() => names(app)).toEqual(["Stopwatch", "Countdown", "Counter"]);

    // A right-click on a row opens the menu beside the row's button, not at the pointer.
    const placed = await inModule<{ over: boolean; flush: boolean; items: number }>(
      app,
      ID,
      `(async () => {
        const row = document.querySelectorAll('article[data-testid^="item-"]')[1];
        const box = row.getBoundingClientRect();
        const x = box.left + 40, y = box.top + box.height / 2;
        row.querySelector("h2").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        const menu = document.querySelector('[role=menu]').getBoundingClientRect();
        const button = row.querySelector('[data-testid^="more-"]').getBoundingClientRect();
        return {
          over: x >= menu.left && x <= menu.right && y >= menu.top && y <= menu.bottom,
          flush: Math.abs(menu.right - button.right) <= 2,
          items: document.querySelectorAll('[role=menuitem]').length,
        };
      })()`,
    );
    expect(placed).toEqual({ over: false, flush: true, items: 4 });
  } finally {
    await app.close();
  }
});

test("dragging a row below the next one and holding it there settles once, and dropping it keeps that order", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    await threeRows(app, page);
    const result = await inModule<{ shifts: string[][]; order: string[] }>(
      app,
      ID,
      `(async () => {
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const list = document.querySelector('[data-testid="row-' + document.querySelector('article').dataset.testid.slice(5) + '"]').parentElement;
        const rows = () => [...list.querySelectorAll("[data-reorder-id]")];
        const transfer = new DataTransfer();
        const fire = (target, type, x, y) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
        const first = rows()[0];
        const under = () => { const at = document.elementFromPoint(x, y); return at && list.contains(at) ? at : list; };
        const second = rows()[1].getBoundingClientRect();
        const start = first.getBoundingClientRect();
        const x = second.left + 40, y = second.top + second.height * 0.8;
        fire(first, "dragstart", start.left + 40, start.top + 10);
        // Hold the pointer low in the second row, the way a hand does, and let the rows slide for a while, as the browser targets
        // whatever is under the pointer at that moment.
        const shifts = [];
        for (let i = 0; i < 8; i++) {
          fire(under(), "dragover", x, y);
          await pause(70);
          shifts.push(rows().map((row) => row.style.translate));
        }
        fire(under(), "drop", x, y);
        fire(first, "dragend", x, y);
        await pause(400);
        return { shifts, order: [...document.querySelectorAll('[data-testid="item-name"] h2')].map((node) => node.textContent.trim()) };
      })()`,
    );
    // Every look at the rows while the pointer rested has the same offsets: nothing swapped back and forth.
    expect(new Set(result.shifts.map((one) => one.join("|"))).size).toBe(1);
    expect(result.shifts[0]!.some((one) => one !== "")).toBe(true);
    // Counter was dragged below Stopwatch.
    expect(result.order).toEqual(["Stopwatch", "Counter", "Countdown"]);
    await expect.poll(() => names(app)).toEqual(["Stopwatch", "Counter", "Countdown"]);
  } finally {
    await app.close();
  }
});

test("a button Tavora refuses for a panel over the game says what to do, in the settings, instead of failing without a word", async () => {
  const { app } = await inPersonalWorkspace();
  try {
    await click(app, "add-counter");
    await click(app, "page-stream");
    await expect.poll(() => inModule<boolean>(app, ID, `!!document.querySelector('[data-testid^="preview-"]')`).catch(() => false)).toBe(true);
    // Tavora's answer for these calls over the game is PERMISSION_DENIED; the page gets it as its bridge would send it.
    await inModule(
      app,
      ID,
      `(() => {
        const original = MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage = function (message, ...rest) {
          if (message && ["overlay.preview", "hotkeys.set", "overlay.showOverGame", "overlay.copyLink"].includes(message.method)) {
            const reply = { v: ${PROTOCOL_VERSION}, id: message.id, ok: false, error: { code: "PERMISSION_DENIED", message: "not available while the panel is shown over the game" } };
            setTimeout(() => this.onmessage?.({ data: reply }), 0);
            return;
          }
          return original.call(this, message, ...rest);
        };
      })()`,
    );
    const note = `document.querySelector('[data-testid="link-note"]')?.textContent?.trim() ?? ""`;
    await inModule(app, ID, `document.querySelector('[data-testid^="preview-"]').click()`);
    await expect.poll(() => inModule<string>(app, ID, note)).toBe("Close the game layer to do this.");
    await inModule(app, ID, `document.querySelector('[data-testid^="copy-link-"]').click()`);
    await expect.poll(() => inModule<string>(app, ID, note)).toBe("Close the game layer to do this.");
    await click(app, "page-hotkeys");
    await inModule(app, ID, `document.querySelector('[aria-label^="Count up: "]').click()`);
    await expect(async () => expect(await text(app, "hotkey-note")).toBe("Close the game layer to do this.")).toPass();
  } finally {
    await app.close();
  }
});

test("the live view lists every clock and counter and counts a running clock itself", async () => {
  // What the panel hands to Tavora (buildLiveState), drawn by the module's real overlay page in a window of the test app.
  const list: ItemList = { items: [] };
  const deaths = newItem("counter", "d", "Deaths") as Counter;
  deaths.value = 7;
  deaths.goal = 10;
  const run = newItem("stopwatch", "r", "Run") as Clock;
  startPause(run, Date.now() - 65_000);
  const boss = newItem("countdown", "b", "Boss") as Clock;
  boss.duration = 90_000;
  for (const item of [deaths, run, boss]) insert(list, item);
  const live = buildLiveState(list, "+{count} more");

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://overlay");
    if (url.pathname === "/_state") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ state: live })}\n\n`);
      return;
    }
    const file = path.join(DIST, url.pathname === "/" ? "overlay.html" : url.pathname);
    try {
      const body = await readFile(file);
      const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}/overlay.html`;
  const { app } = await inPersonalWorkspace();
  try {
    await app.evaluate(({ BrowserWindow }, address) => {
      const window = new BrowserWindow({ width: 360, height: 220, show: false, backgroundColor: "#1c1a18", webPreferences: { partition: "live-view-test" } });
      void window.loadURL(address);
    }, address);
    await expect.poll(() => app.windows().some((candidate) => candidate.url() === address)).toBe(true);
    const view = app.windows().find((candidate) => candidate.url() === address)!;
    await expect(view.locator("#live li")).toHaveCount(3);
    await expect(view.locator("#live li .name")).toHaveText(["Deaths", "Run", "Boss"]);
    await expect(view.locator("#live li .amount")).toHaveText(["7 / 10", /^1:0[5-9]$/, "1:30"]);
    // A running clock moves on without the panel sending anything.
    await expect(view.locator("#live li .amount").nth(1)).toHaveText(/^1:(0[6-9]|1\d)$/, { timeout: 6000 });
    await expect(view.locator("#overlay")).toBeHidden();
    if (SHOTS) await view.screenshot({ path: path.join(SHOTS, "live-view.png") });
  } finally {
    await app.close();
    server.close();
  }
});
