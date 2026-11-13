import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { inModule, launch, newUserData, openModule, seedLibrary, waitForShown } from "./harness";
import type { LayoutView } from "../../src/shared/layout-view";
import { newItem, overlayState, type Counter, type OverlayState } from "../../../../modules/clock-counter/src/items";

// A Clock & Counter overlay's text in its box (the kit's OverlayText), in the hidden test app. Grows with the text: the frame on the
// Overlay page is as big as the text, a corner drag scales it, a bigger step makes the frame bigger at the same scale, and Reset
// size goes back to 100 %. Fixed size: the text keeps its step, and a long one scrolls (a compositor animation of transform),
// shrinks or is cut off, and is cut off with reduced motion. In OBS (no Tavora frame) a growing text fills its Browser Source as
// before. No window here is ever on screen: the app is hidden and the overlays stay stopped, as after every start.

const MODULES = path.resolve("../../modules");
const DIST = path.join(MODULES, "clock-counter/dist");
const ID = "tavora.clock-counter";

type Host = { tavoraHost: { act(action: unknown): Promise<unknown>; layout: { getState(): Promise<LayoutView>; send(message: unknown): void } } };

const state = (page: Page) => page.evaluate(() => (window as unknown as Host).tavoraHost.layout.getState());
const send = (page: Page, message: unknown) => page.evaluate((message) => (window as unknown as Host).tavoraHost.layout.send(message), message);

async function inPanel<T = unknown>(app: ElectronApplication, testId: string, script: string): Promise<T> {
  await expect.poll(() => inModule<boolean>(app, ID, `!!document.querySelector('[data-testid="${testId}"]')`).catch(() => false)).toBe(true);
  return inModule<T>(app, ID, script);
}
const click = (app: ElectronApplication, testId: string) => inPanel(app, testId, `document.querySelector('[data-testid="${testId}"]').click()`);

/** Runs `script` in the page of the overlay frame on the Overlay page (the one Tavora loads as a frame of its own). */
async function inFrame<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, script) => {
    const frame = webContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getURL().includes("tavoraFrame=1"));
    if (!frame) throw new Error("no overlay frame");
    return frame.executeJavaScript(script);
  }, script);
}
/**
 * Sets the frame page's prefers-reduced-motion. The session stays attached until the app closes: detaching it clears every media
 * emulation of the page, which then follows the PC's own setting (the CI runners prefer reduced motion), not the one asked for.
 * The frame's page may not be there yet (a slower PC): it waits for it, as the other looks into the frame do.
 */
async function reducedMotion(app: ElectronApplication, on: boolean): Promise<void> {
  await expect
    .poll(
      () =>
        app.evaluate(async ({ webContents }, on) => {
          const frame = webContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getURL().includes("tavoraFrame=1"));
          if (!frame) return false;
          if (!frame.debugger.isAttached()) frame.debugger.attach();
          await frame.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }] });
          return true;
        }, on),
      { timeout: 15_000 },
    )
    .toBe(true);
}
/** The box as the frame's page draws it: the font size of 100 % and what it does with the text. */
const box = (app: ElectronApplication) =>
  inFrame<{ font: number; mode: string; box: string; soft: string; copy: string; moving: number }>(
    app,
    `(() => {
      const host = document.querySelector(".tv-otext");
      const track = document.querySelector(".tv-otext__track");
      if (!host || !track) return { font: 0, mode: "", box: "", soft: "", copy: "", moving: 0 };
      const moving = document.getAnimations().filter((one) => one.playState === "running" && one.effect.getKeyframes().every((frame) => Object.keys(frame).every((key) => ["transform", "offset", "easing", "composite", "computedOffset"].includes(key)))).length;
      return { font: parseFloat(getComputedStyle(track).fontSize), mode: host.dataset.mode, box: host.dataset.box, soft: host.dataset.soft, copy: document.querySelector(".tv-otext__copy").textContent, moving };
    })()`,
  ).catch(() => ({ font: 0, mode: "", box: "", soft: "", copy: "", moving: 0 }));

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
  await page.getByTestId("personal-name").press("Enter");
  await expect(page.getByTestId("rail-workspace-local-personal")).toHaveAttribute("aria-current", "page");
  await openModule(page, ID);
  await waitForShown(app, ID);
  return { app, page };
}

/** Adds a counter, sets it up on its settings pages with `setUp`, then puts it on the Overlay page: the frame's id. */
async function counterOnOverlayPage(app: ElectronApplication, page: Page, setUp: () => Promise<void> = async () => {}): Promise<string> {
  await click(app, "add-counter");
  await setUp();
  await closeSettings(page);
  await page.evaluate(() => (window as unknown as Host).tavoraHost.act({ type: "open-overlay-page" }));
  await expect(page.getByTestId("overlay-page")).toBeVisible();
  await expect.poll(async () => (await state(page)).sources[0]?.children?.length).toBe(1);
  const header = (await state(page)).sources[0]!;
  await page.getByTestId(`layout-source-${header.id}:${header.children![0]!.key}`).getByRole("button").first().click();
  await expect.poll(async () => (await state(page)).items.length).toBe(1);
  return (await state(page)).items[0]!.id;
}

const itemOf = async (page: Page) => (await state(page)).items[0]!;
// The canvas draws the frames smaller than the game would, so a frame is a pixel off and the text up to 1.5 px from its size.

test("a text that grows: its frame is as big as the text, scales from a corner, follows a bigger step and goes back to 100 % with Reset size", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    const id = await counterOnOverlayPage(app, page);
    // The frame is the text at 100 % with the room around it, not a box the text is stretched to fill.
    const added = await itemOf(page);
    expect(added.natural).not.toBeNull();
    expect(added.scale).toBe(1);
    expect(added.placed.width).toBe(added.natural!.width + 16);
    expect(added.placed.height).toBe(added.natural!.height + 16);
    await expect.poll(async () => Math.abs((await box(app)).font - 48)).toBeLessThan(1.5);
    expect((await box(app)).box).toBe("grow");

    // A corner pulled out to twice the text: the scale is 2, the frame keeps the text's shape, and the text is drawn at twice its size.
    const natural = added.natural!;
    await send(page, { type: "commit", id, rect: { x: added.placed.x, y: added.placed.y, width: natural.width * 2 + 16, height: natural.height * 2 + 16 } });
    await expect.poll(async () => (await itemOf(page)).scale).toBeCloseTo(2, 1);
    const scaled = await itemOf(page);
    expect(scaled.placed.height).toBeCloseTo(natural.height * scaled.scale + 16, -1);
    await expect.poll(async () => (await box(app)).font).toBeGreaterThan(90);

    // A bigger step for words and number: the text gets bigger, the frame with it, and the scale stays.
    await page.getByTestId(`layout-gear-${id}`).click();
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await click(app, "page-look");
    await click(app, "number-size-xl");
    await click(app, "words-size-xl");
    await expect.poll(async () => (await itemOf(page)).natural!.height).toBeGreaterThan(natural.height);
    const bigger = await itemOf(page);
    expect(bigger.scale).toBeCloseTo(scaled.scale, 5);
    expect(bigger.placed.height).toBeGreaterThan(scaled.placed.height);
    expect(bigger.placed.width).toBeCloseTo(bigger.natural!.width * bigger.scale + 16, -1);
    await closeSettings(page);

    // Reset size: 100 % again, where it is.
    await send(page, { type: "reset-size", id });
    await expect.poll(async () => (await itemOf(page)).scale).toBe(1);
    const reset = await itemOf(page);
    expect(reset.placed).toMatchObject({ x: bigger.placed.x, y: bigger.placed.y, width: reset.natural!.width + 16, height: reset.natural!.height + 16 });
    await expect.poll(async () => Math.abs((await box(app)).font - 48)).toBeLessThan(1.5);
  } finally {
    await app.close();
  }
});

test("a fixed box keeps the text at its step: a long text scrolls in a loop, goes on while it counts, shrinks or is cut off, and is cut off with reduced motion", async () => {
  const { app, page } = await inPersonalWorkspace();
  try {
    const id = await counterOnOverlayPage(app, page, async () => {
      await click(app, "page-text");
      await inModule(
        app,
        ID,
        `(async () => {
          const field = document.querySelector('[data-testid="overlay-text"]');
          field.focus();
          field.value = "Deaths in this very long run, counted since the start: {count}";
          field.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 50));
          field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        })()`,
      );
      await click(app, "page-look");
      await click(app, "box-fixed");
      // Too long, speed, pause and soft edges show for a fixed box; Scroll is the default.
      await inPanel(app, "too-long-scroll", "true");
      await inPanel(app, "pause", "true");
      await inPanel(app, "soft-edges", "true");
    });
    // A fixed box is not a frame that follows the text: the user sizes it.
    // (The panel sends its list a moment after the change, a little later while it is hidden behind the Overlay page.)
    await expect.poll(async () => (await itemOf(page)).natural).toBeNull();
    const placed = (await itemOf(page)).placed;
    await send(page, { type: "commit", id, rect: { x: placed.x, y: placed.y, width: 400, height: 80 } });
    await expect.poll(async () => (await itemOf(page)).placed.width).toBe(400);
    // Whatever the PC prefers: this test says when there is less motion.
    await reducedMotion(app, false);

    // Too long for 400: it scrolls at its step (48 px at M), with its copy after a gap and soft edges, on the compositor.
    await expect.poll(async () => (await box(app)).mode).toBe("scroll");
    const scrolling = await box(app);
    expect(scrolling).toMatchObject({ box: "fixed", soft: "true", moving: 1 });
    expect(Math.abs(scrolling.font - 48)).toBeLessThan(1.5);
    expect(scrolling.copy).toContain("Deaths in this very long run");

    // A count goes on where the scroll is; it doesn't start the round again.
    await new Promise((resolve) => setTimeout(resolve, 2600));
    const time = () => inFrame<number>(app, `document.getAnimations()[0]?.currentTime ?? -1`);
    const before = await time();
    await click(app, "up");
    await expect.poll(() => inFrame<string>(app, `document.querySelector(".tv-otext__content").textContent`)).toContain(": 1");
    expect(await time()).toBeGreaterThanOrEqual(before);

    // Big enough: it stands still, at its step, and the scroll is gone.
    await send(page, { type: "commit", id, rect: { x: placed.x, y: placed.y, width: 1900, height: 80 } });
    await expect.poll(async () => (await box(app)).mode).toBe("static");
    expect(await box(app)).toMatchObject({ moving: 0, copy: "" });
    expect(Math.abs((await box(app)).font - 48)).toBeLessThan(1.5);
    await send(page, { type: "commit", id, rect: { x: placed.x, y: placed.y, width: 400, height: 80 } });
    await expect.poll(async () => (await box(app)).mode).toBe("scroll");

    // With reduced motion it is cut off instead, and it scrolls again once motion is back, from the start of a round.
    await reducedMotion(app, true);
    await expect.poll(async () => (await box(app)).mode).toBe("cut");
    expect((await box(app)).moving).toBe(0);
    await reducedMotion(app, false);
    await expect.poll(async () => (await box(app)).mode).toBe("scroll");
    expect((await box(app)).moving).toBe(1);

    // Shrink: smaller until it fits, never bigger than its step. Cut off: ends with "…" at its step.
    await page.getByTestId(`layout-gear-${id}`).click();
    await click(app, "page-look");
    await click(app, "too-long-shrink");
    await expect.poll(async () => (await box(app)).font).toBeLessThan(40);
    expect((await box(app)).mode).toBe("static");
    await click(app, "too-long-cut");
    await expect.poll(async () => (await box(app)).mode).toBe("cut");
    expect(Math.abs((await box(app)).font - 48)).toBeLessThan(1.5);
    await closeSettings(page);
  } finally {
    await app.close();
  }
});

test("in OBS a text that grows fills its Browser Source as before, and a fixed box scrolls a long text in it", async () => {
  // The module's real overlay page, served as Tavora serves it to OBS (no frame of Tavora's own), with what the panel publishes.
  const deaths = newItem("counter", "d", "Deaths") as Counter;
  deaths.value = 7;
  let published: OverlayState = overlayState(deaths);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://overlay");
    if (url.pathname === "/_state") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ state: published })}\n\n`);
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
    const open = async (partition: string) => {
      await app.evaluate(({ BrowserWindow }, { address, partition }) => {
        const window = new BrowserWindow({ width: 600, height: 150, useContentSize: true, show: false, webPreferences: { partition } });
        void window.loadURL(`${address}?${partition}`);
      }, { address, partition });
      await expect.poll(() => app.windows().some((candidate) => candidate.url().endsWith(partition))).toBe(true);
      return app.windows().find((candidate) => candidate.url().endsWith(partition))!;
    };
    const obs = await open("grows");
    await expect(obs.locator(".tv-otext__content")).toHaveText("Deaths 7");
    // It fills the 600 × 150 window as it always did: far bigger than the 48 px of M.
    await expect.poll(() => obs.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".tv-otext__track")!).fontSize))).toBeGreaterThan(100);
    expect(await obs.evaluate(() => document.querySelector<HTMLElement>(".tv-otext")!.dataset.box)).toBe("grow");

    published = overlayState({ ...deaths, look: { ...deaths.look, box: "fixed", text: "Deaths in this very long run, counted since the start: {count}" } });
    const fixed = await open("fixed");
    await expect.poll(() => fixed.evaluate(() => document.querySelector<HTMLElement>(".tv-otext")?.dataset.mode)).toBe("scroll");
    expect(await fixed.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".tv-otext__track")!).fontSize))).toBeCloseTo(48, 0);
    expect(await fixed.evaluate(() => document.getAnimations().length)).toBe(1);
  } finally {
    await app.close();
    server.close();
  }
});
