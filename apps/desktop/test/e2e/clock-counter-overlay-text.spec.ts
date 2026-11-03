import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { inModule, launch, newUserData, openModule, seedLibrary, waitForShown } from "./harness";
import type { LayoutView } from "../../src/shared/layout-view";
import { newItem, overlayState, type Counter, type OverlayLook, type OverlayState } from "../../../../modules/clock-counter/src/items";

// The overlay text of Clock & Counter in both boxes. Its real overlay page, in a window of the test app, draws a text that grows
// with its frame and one in a fixed box (scroll, shrink, cut off, reduced motion, hidden). And on the Overlay page, a frame that
// grows with its text follows the size step and keeps its shape, while a fixed box keeps the size it was given.

const MODULES = path.resolve("../../modules");
const DIST = path.join(MODULES, "clock-counter/dist");
const ID = "tavora.clock-counter";

type Host = { tavoraHost: { act(action: unknown): Promise<unknown>; layout: { getState(): Promise<LayoutView> } } };

/** Serves the built overlay page; it shows whatever `shown.state` is when it (re)loads. */
async function overlayServer(shown: { state: OverlayState }): Promise<{ server: Server; address: string }> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://overlay");
    if (url.pathname === "/_state") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ state: shown.state })}\n\n`);
      return;
    }
    const file = path.join(DIST, url.pathname === "/" ? "overlay.html" : url.pathname);
    try {
      const body = await readFile(file);
      const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, address: `http://127.0.0.1:${(server.address() as { port: number }).port}/overlay.html` };
}

async function launchPersonal(): Promise<{ app: ElectronApplication; page: Page }> {
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

const counter = (text: string, look: Partial<OverlayLook> = {}): OverlayState => {
  const item = newItem("counter", "d", "Deaths") as Counter;
  item.value = 7;
  item.look = { ...item.look, text, align: "left", ...look };
  return overlayState(item);
};
const fixed = (overflow: "scroll" | "shrink" | "clip", more: Partial<OverlayLook> = {}): Partial<OverlayLook> => ({ textBox: { mode: "fixed", overflow, speed: "normal", pause: 2, softEdges: true }, ...more });

test("the overlay page grows its text with the frame, and keeps it at its size in a fixed box that scrolls, shrinks or cuts off", async () => {
  const shown = { state: counter("{count}") };
  const { server, address } = await overlayServer(shown);
  const { app } = await launchPersonal();
  try {
    // A frame as one from before: 500 × 66 with a short text.
    await app.evaluate(({ BrowserWindow }, address) => {
      const window = new BrowserWindow({ width: 500, height: 66, useContentSize: true, show: true, frame: false, transparent: true, webPreferences: { partition: "overlay-text-test" } });
      (globalThis as { overlayTextWindow?: unknown }).overlayTextWindow = window;
      void window.loadURL(address);
    }, address);
    await expect.poll(() => app.windows().some((candidate) => candidate.url() === address)).toBe(true);
    const view = app.windows().find((candidate) => candidate.url() === address)!;
    const look = () =>
      view.evaluate(() => {
        const root = document.querySelector<HTMLElement>("#overlay")!;
        const number = root.querySelector<HTMLElement>(".tavora-overlay-text-content .cc-n")!;
        const track = root.querySelector<HTMLElement>(".tavora-overlay-text-track")!;
        return {
          mode: root.dataset.mode,
          plan: root.dataset.plan,
          fade: root.dataset.fade,
          scale: Number(root.style.getPropertyValue("--overlay-text-scale")),
          numberPx: parseFloat(getComputedStyle(number).fontSize),
          animations: track.getAnimations().map((animation) => ({ state: animation.playState, frames: (animation.effect as KeyframeEffect).getKeyframes().map((frame) => Object.keys(frame).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key))) })),
          mask: getComputedStyle(root).maskImage || getComputedStyle(root).getPropertyValue("-webkit-mask-image"),
          ellipsis: getComputedStyle(root.querySelector(".cc-line")!).textOverflow,
          copies: root.querySelectorAll(".tavora-overlay-text-copy").length,
        };
      });
    const reload = async (state: OverlayState) => {
      shown.state = state;
      await view.reload();
      await expect.poll(async () => (await look().catch(() => null))?.plan).toBeTruthy();
    };
    await reload(shown.state);

    // Grows with the text: the "7" is drawn as big as the frame's height allows (50 of 66, 8 around it), at its real size.
    await expect.poll(async () => (await look()).mode).toBe("grow");
    const grown = await look();
    expect(grown.scale).toBeCloseTo(50 / (48 * 1.05), 1);
    expect(grown.numberPx).toBeCloseTo(48 * grown.scale, 0);
    expect(grown.animations).toHaveLength(0);

    // A fixed box: the short text keeps its own size (48 px at M) and doesn't scroll.
    await reload(counter("{count}", fixed("scroll", { numberStep: "m" })));
    await expect.poll(async () => (await look()).mode).toBe("fixed");
    expect(await look()).toMatchObject({ plan: "fit", scale: 1, numberPx: 48, animations: [] });

    // Too long: it scrolls, by a transform only, with a copy behind it and soft edges.
    await reload(counter("Deaths in the long dark cave of the very last boss: {count}", fixed("scroll")));
    await expect.poll(async () => (await look()).plan).toBe("scroll");
    const scrolling = await look();
    expect(scrolling.numberPx).toBe(48);
    expect(scrolling.animations).toEqual([{ state: "running", frames: [["transform"], ["transform"], ["transform"]] }]);
    expect(scrolling.copies).toBe(1);
    expect(scrolling.fade).toBe("true");
    expect(scrolling.mask).toContain("linear-gradient");

    // Hidden (the overlay is off, or OBS doesn't show the source): the scroll waits. Playwright keeps a page it drives
    // "visible" whatever its window does, so the page is told the way Chromium tells it.
    const visibility = (state: "hidden" | "visible") =>
      view.evaluate((state) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    await visibility("hidden");
    await expect.poll(async () => (await look()).animations[0]?.state).toBe("paused");
    await visibility("visible");
    await expect.poll(async () => (await look()).animations[0]?.state).toBe("running");

    // The frame made wider than the text while it scrolls: it stops, and starts again once it is narrow.
    await app.evaluate(() => (globalThis as { overlayTextWindow?: { setContentSize(w: number, h: number): void } }).overlayTextWindow!.setContentSize(1900, 66));
    await expect.poll(async () => (await look()).plan).toBe("fit");
    expect((await look()).animations).toHaveLength(0);
    await app.evaluate(() => (globalThis as { overlayTextWindow?: { setContentSize(w: number, h: number): void } }).overlayTextWindow!.setContentSize(500, 66));
    await expect.poll(async () => (await look()).plan).toBe("scroll");

    // Reduced motion: cut off instead of scrolling.
    await view.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(async () => (await look()).plan).toBe("clip");
    expect((await look()).animations).toHaveLength(0);
    await view.emulateMedia({ reducedMotion: "no-preference" });

    // Shrink: smaller until it fits, never bigger than its step.
    await reload(counter("Deaths in the long dark cave of the very last boss: {count}", fixed("shrink")));
    const shrunk = await look();
    expect(shrunk.plan).toBe("fit");
    expect(shrunk.scale).toBeLessThan(1);
    expect(shrunk.numberPx).toBeLessThan(48);

    // Cut off: it ends with "…".
    await reload(counter("Deaths in the long dark cave of the very last boss: {count}", fixed("clip")));
    expect(await look()).toMatchObject({ plan: "clip", ellipsis: "ellipsis", numberPx: 48 });

    // Words and number at different steps on one line, in both boxes.
    await reload(counter("Deaths {count}", { wordsStep: "xs", numberStep: "xl" }));
    const mixedGrow = await view.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".tavora-overlay-text-content .cc-line > span")).map((run) => parseFloat(getComputedStyle(run).fontSize)));
    expect(mixedGrow[1]! / mixedGrow[0]!).toBeCloseTo(20 / 12, 1);
    await reload(counter("Deaths {count}", fixed("scroll", { wordsStep: "xs", numberStep: "xl" })));
    const mixedFixed = await view.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".tavora-overlay-text-content .cc-line > span")).map((run) => parseFloat(getComputedStyle(run).fontSize)));
    expect(mixedFixed).toEqual([48 * (12 / 14), 48 * (20 / 14)].map((px) => expect.closeTo(px, 1)));
  } finally {
    await app.evaluate(() => (globalThis as { overlayTextWindow?: { destroy(): void } }).overlayTextWindow?.destroy()).catch(() => {});
    await app.close();
    server.close();
  }
});

test("on the Overlay page a frame that grows with its text follows the size step and keeps its shape; a fixed box keeps its size", async () => {
  const { app, page } = await launchPersonal();
  const state = () => page.evaluate(() => (window as unknown as Host).tavoraHost.layout.getState());
  /** The canvas of the Overlay page is a layer of its own over the main window. */
  const layer = () => app.windows().find((candidate) => candidate.url().endsWith("#layer"))!;
  const inPanel = async (testId: string, script: string) => {
    await expect.poll(() => inModule<boolean>(app, ID, `!!document.querySelector('[data-testid="${testId}"]')`).catch(() => false)).toBe(true);
    return inModule(app, ID, script);
  };
  const click = (testId: string) => inPanel(testId, `document.querySelector('[data-testid="${testId}"]').click()`);
  const closeSettings = async () => {
    await page.getByTestId("panel-dialog-close").click();
    await expect(page.getByTestId("panel-dialog")).toHaveCount(0);
  };
  try {
    await click("add-counter");
    await closeSettings();
    await page.evaluate(() => (window as unknown as Host).tavoraHost.act({ type: "open-overlay-page" }));
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    await expect.poll(() => app.windows().some((candidate) => candidate.url().endsWith("#layer"))).toBe(true);
    await expect.poll(async () => (await state()).sources[0]?.children?.length).toBe(1);
    const header = (await state()).sources[0]!;
    await page.getByTestId(`layout-source-${header.id}:${header.children![0]!.key}`).getByRole("button").first().click();
    await expect.poll(async () => (await state()).items.length).toBe(1);
    const item = (await state()).items[0]!;
    expect(item.fitText).toBe(true);
    const at = item.placed;

    // It scales from its corners only.
    await expect(layer().getByTestId("layout-handle-br")).toBeVisible();
    await expect(layer().getByTestId("layout-handle-r")).toHaveCount(0);
    await expect(layer().getByTestId("layout-handle-t")).toHaveCount(0);

    // Number at XL instead of M: the frame grows with the text and keeps its middle (a new item is centred).
    await page.getByTestId(`layout-gear-${item.id}`).click();
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await click("page-look");
    await click("number-size-xl");
    await closeSettings();
    await expect.poll(async () => (await state()).items[0]!.placed.height).toBeGreaterThan(at.height + 10);
    const grown = (await state()).items[0]!.placed;
    expect(Math.abs(grown.x + grown.width / 2 - (at.x + at.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(grown.y + grown.height / 2 - (at.y + at.height / 2))).toBeLessThanOrEqual(1);
    expect((grown.height - 16) / (at.height - 16)).toBeCloseTo(20 / 14, 1);

    // A fixed box: the frame keeps the size it has and gets its edge handles back.
    await page.getByTestId(`layout-gear-${item.id}`).click();
    await click("page-look");
    await click("box-fixed");
    await expect.poll(() => inModule<boolean>(app, ID, `!!document.querySelector('[data-testid="box-scroll"]')`)).toBe(true);
    await closeSettings();
    await expect.poll(async () => (await state()).items[0]!.fitText).toBe(false);
    await expect(layer().getByTestId("layout-handle-r")).toBeVisible();
    expect((await state()).items[0]!.placed).toEqual(grown);
  } finally {
    await app.close();
  }
});
