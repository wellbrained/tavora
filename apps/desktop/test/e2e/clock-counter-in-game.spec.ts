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
    await click(app, "editor-done");
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
    expect(item.placed.width).toBeLessThan(340);
    expect(item.placed.height).toBeLessThan(130);
    await expect(page.getByTestId("layout-count")).toHaveText("1 of 8");
    await expect(page.getByTestId("layout-settings")).toContainText(second.name);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sources-added.png") });

    // Settings, from the row's gear: the panel's dialog over the Overlay page, which stays where it is.
    await page.getByTestId(`layout-gear-${item.id}`).click();
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    await expect.poll(() => inModule<boolean>(app, ID, `!!document.querySelector('[data-testid^="editor-"]')`).catch(() => false)).toBe(true);
    await page.getByTestId("panel-dialog-close").click();
    await expect(page.getByTestId("panel-dialog")).toHaveCount(0);
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    expect((await state(page)).selection).toBe(item.id);
  } finally {
    await app.close();
  }
});

test("counting, Start and Reset work, and Add is a menu in the page rather than one Tavora draws", async () => {
  const { app } = await inPersonalWorkspace();
  try {
    await click(app, "add-counter");
    // A new item opens its settings (a dialog over the workspace); Done goes back to the list.
    await click(app, "editor-done");
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

test("a button Tavora refuses for a panel over the game says what to do, in the settings, instead of failing without a word", async () => {
  const { app } = await inPersonalWorkspace();
  try {
    await click(app, "add-counter");
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
    const note = `document.querySelector('[data-testid^="editor-"] [role="status"]')?.textContent?.trim() ?? ""`;
    await inModule(app, ID, `document.querySelector('[data-testid^="preview-"]').click()`);
    await expect.poll(() => inModule<string>(app, ID, note)).toBe("Close the game layer to do this.");
    await inModule(app, ID, `document.querySelector('[data-testid^="copy-link-"]').click()`);
    await expect.poll(() => inModule<string>(app, ID, note)).toBe("Close the game layer to do this.");
    await inModule(app, ID, `document.querySelector('[data-testid^="over-game-"]').click()`);
    await expect.poll(() => inModule<string>(app, ID, note)).toBe("Close the game layer to do this.");
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
