import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import type { LayoutGroup, LayoutNode, LayoutSplit, SavedLayout } from "../../src/shared/host-api";

const here = path.dirname(fileURLToPath(import.meta.url));
export const desktopDir = path.resolve(here, "../..");
const repoRoot = path.resolve(desktopDir, "../..");

export const VANILLA = "local.example.vanilla-module";
export const REACT = "local.example.react-module";
export const VUE = "local.example.vue-module";
/** The example modules: same features, different frameworks. */
export const EXAMPLES = [
  { name: "vanilla", id: VANILLA },
  { name: "React", id: REACT },
  { name: "Vue", id: VUE },
] as const;
export const HOSTILE = "local.test.hostile-module";

export interface Running {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

export async function newUserData(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tavora-e2e-"));
}

export const FIXTURES = path.join(desktopDir, "test/fixtures");

/** Content size the harness gives the window, so layouts do not depend on the test display. */
export const WINDOW = { width: 1400, height: 900 } as const;
/** Width of the collapsed rail. */
export const RAIL_WIDTH = 72;

function seedWorkspace(id: string, name: string, text: string, addedAt: string) {
  return {
    id,
    kind: "game",
    catalogId: id,
    name,
    icon: { kind: "monogram", text },
    showNews: true,
    addedAt,
    lastOpenedAt: id === "poe2" ? addedAt : null,
    trashedAt: null,
  };
}

/** A library with the game workspaces of Path of Exile 2 and Satisfactory that opens on Path of Exile 2. */
export function seedLibrary() {
  const at = "2026-10-01T12:00:00.000Z";
  return {
    version: 2,
    workspaces: {
      poe2: seedWorkspace("poe2", "Path of Exile 2", "PE2", at),
      satisfactory: seedWorkspace("satisfactory", "Satisfactory", "S", at),
    },
    folders: {},
    root: [
      { kind: "workspace", id: "poe2" },
      { kind: "workspace", id: "satisfactory" },
    ],
    favorites: [],
    sort: "manual",
    rail: { expanded: false, width: 280 },
    startup: "last-workspace",
    lastWorkspaceId: "poe2",
  };
}

export interface LaunchOptions {
  /** Write the two-workspace library before the first start (default true). */
  seed?: boolean;
  /** What the system pretends to be (default dark), so the theme tests do not depend on the PC. */
  systemTheme?: "dark" | "light";
  /** What the system pretends to speak (default en). */
  locale?: string;
  /** More command line switches for Chromium, e.g. host resolver rules. */
  args?: string[];
  /** More environment variables, e.g. a pretend Discord app. */
  env?: Record<string, string>;
}

export async function launch(
  userData?: string,
  extraModuleDirs: string[] = [],
  { seed = true, systemTheme, locale, args = [], env = {} }: LaunchOptions = {},
): Promise<Running> {
  const dir = userData ?? (await newUserData());
  const libraryFile = path.join(dir, "library.json");
  const exists = await access(libraryFile).then(
    () => true,
    () => false,
  );
  if (seed && !exists) await writeFile(libraryFile, JSON.stringify(seedLibrary()));
  const app = await electron.launch({
    args: [desktopDir, ...args],
    env: {
      ...process.env,
      TAVORA_USER_DATA: dir,
      // Pictures a module saves land here, never in the Pictures folder of the PC the tests run on.
      TAVORA_PICTURES_DIR: path.join(dir, "Pictures"),
      // Tests never look at the Steam client on this machine or ask Steam for icons.
      TAVORA_STEAM_ICONS_URL: "off",
      // Tests never see the games installed on this PC; a test that wants some sets TAVORA_TEST_INSTALLED.
      TAVORA_TEST_INSTALLED: "[]",
      // Tests read English texts whatever language the PC they run on speaks.
      TAVORA_LOCALE: locale ?? "en",
      // Set TAVORA_HIDDEN=0 to watch the windows while debugging a test.
      TAVORA_HIDDEN: process.env.TAVORA_HIDDEN ?? "1",
      // The system is pretended to be dark, so the theme tests do not depend on the PC they run on.
      TAVORA_SYSTEM_THEME: systemTheme ?? process.env.TAVORA_SYSTEM_THEME ?? "dark",
      TAVORA_MODULE_DIRS: [path.join(repoRoot, "examples"), FIXTURES, ...extraModuleDirs].join(path.delimiter),
      ...env,
    },
  });
  const page = await hostWindow(app);
  await expect(page.getByTestId("rail")).toBeVisible();
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), WINDOW);
  return { app, page, userData: dir };
}

/** Opens the Add a game picker from the rail's Add game button. */
export async function openAddGame(page: Page): Promise<void> {
  await page.getByTestId("rail-add-game").click();
  await expect(page.getByTestId("add-game-dialog")).toBeVisible();
}

/** The Tavora window. Panels restored from the last run can open before it, so the first window is not always this one. */
async function hostWindow(app: ElectronApplication): Promise<Page> {
  const isHost = (page: Page) => page.url().startsWith("tavora-host://app/");
  await expect.poll(() => app.windows().some(isHost)).toBe(true);
  return app.windows().find(isHost)!;
}

/** Runs JavaScript inside the nth panel of a module and returns the result. */

export async function inModule<T>(app: ElectronApplication, moduleId: string, script: string, index = 0): Promise<T> {
  return app.evaluate(
    async ({ webContents }, { moduleId, script, index }) => {
      const views = webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`))
        .sort((a, b) => a.id - b.id);
      const target = views[index];
      if (!target) throw new Error(`no panel ${index} for ${moduleId}`);
      return target.executeJavaScript(script, true);
    },
    { moduleId, script, index },
  ) as Promise<T>;
}

/** Waits until a module panel shows the expected text in a data-testid element. */
export async function expectModuleText(
  app: ElectronApplication,
  moduleId: string,
  testId: string,
  expected: string | RegExp,
  index = 0,
): Promise<void> {
  const shown = () =>
    inModule<string | null>(
      app,
      moduleId,
      `document.querySelector('[data-testid="${testId}"]')?.textContent ?? null`,
      index,
    ).catch(() => null);
  // A text that only has to contain something (a RegExp) tolerates a panel that loads more than once.
  if (typeof expected === "string") await expect.poll(shown).toBe(expected);
  else await expect.poll(async () => (await shown()) ?? "").toMatch(expected);
}

/** Opens a workspace from the rail and waits for it. */
export async function openWorkspace(page: Page, workspaceId: string): Promise<void> {
  await page.getByTestId(`rail-workspace-${workspaceId}`).click();
  await expect(page.getByTestId(`rail-workspace-${workspaceId}`)).toHaveAttribute("aria-current", "page");
}

/**
 * Waits until the layout saved on disk for a workspace is the one the test is about to restart on. The dock saves a
 * moment after its last change (300 ms), and closing the app does not flush it, so a test that restarts waits for the
 * file, not for a fixed time. `check` gets every group and split of the saved layout.
 */
export async function expectLayoutSaved(userData: string, check: (nodes: LayoutNode[]) => boolean, workspaceId = "poe2"): Promise<void> {
  const nodes = (node: LayoutNode): LayoutNode[] => (node.kind === "group" ? [node] : [node, ...node.children.flatMap(nodes)]);
  await expect
    .poll(async () => {
      try {
        const saved = JSON.parse(await readFile(path.join(userData, "workspace.json"), "utf8")) as { workspaces: Record<string, { layout: SavedLayout | null }> };
        const layout = saved.workspaces[workspaceId]?.layout;
        return !!layout && check(nodes(layout.root));
      } catch {
        // The file is replaced as it is written; try again.
        return false;
      }
    })
    .toBe(true);
}

/** The groups among saved layout nodes. */
export const groupsIn = (nodes: LayoutNode[]): LayoutGroup[] => nodes.filter((node): node is LayoutGroup => node.kind === "group");
export type { LayoutGroup, LayoutNode, LayoutSplit };

/** Sets the window's content size. */
export async function setContentSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), {
    width,
    height,
  });
}

/** Opens a module from the module library behind the header's Add module button. */
export async function openModule(page: Page, moduleId: string): Promise<void> {
  await page.getByTestId("add-module").click();
  await page.getByTestId(`open-${moduleId}`).click();
  await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);
}


/**
 * Lays out `count` empty columns side by side in the workspace shown, which the next modules added fill in
 * order. Without it a module added goes in as a tab in the group the user works in.
 */
export async function layOutColumns(page: Page, count: number) {
  await page.getByTestId("layouts").click();
  await page.locator(`[role="menu"][data-state="open"] [data-testid="layout-grid-${count}x1"]`).click();
  await expect(page.locator("[data-testid^='empty-slot-']")).toHaveCount(count);
}
/** The tabs of open panels, optionally of one module. */
export function panels(page: Page, moduleId?: string) {
  return page.locator(moduleId ? `[data-panel-tab][data-module-id="${moduleId}"]` : "[data-panel-tab]");
}

/** The JavaScript expression that finds a module page's element by its data-testid. */
export const q = (testId: string) => `document.querySelector('[data-testid="${testId}"]')`;

/** Clicks the element a CSS selector finds in the nth panel of a module (a script click, not a real one). */
export async function clickSelector(app: ElectronApplication, moduleId: string, selector: string, index = 0) {
  await inModule(app, moduleId, `document.querySelector(${JSON.stringify(selector)}).click()`, index);
}

export async function clickInModule(app: ElectronApplication, moduleId: string, testId: string, index = 0) {
  await clickSelector(app, moduleId, `[data-testid="${testId}"]`, index);
}

/**
 * A real click (Electron input events) in the middle of the element `selector` finds in a module's page, so the host
 * counts it as the user's. It waits until the element stands still first: a panel that just opened, or a menu that is
 * still being positioned, moves for a moment. `scroll` brings the element into view first.
 */
export async function realClick(app: ElectronApplication, moduleId: string, selector: string, { scroll = false }: { scroll?: boolean } = {}) {
  const where = () =>
    inModule<string>(
      app,
      moduleId,
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return ""; ${scroll ? 'element.scrollIntoView({ block: "center" });' : ""} const r = element.getBoundingClientRect(); return r.width && r.height ? JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }) : ""; })()`,
    ).catch(() => "");
  let box = "";
  await expect
    .poll(async () => {
      const last = box;
      box = await where();
      return box !== "" && box === last;
    })
    .toBe(true);
  const at = JSON.parse(box) as { x: number; y: number };
  await app.evaluate(
    ({ webContents }, { moduleId, x, y }) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
      if (!target) throw new Error("no panel");
      const point = { x, y, button: "left" as const, clickCount: 1 };
      target.sendInputEvent({ type: "mouseMove", ...point });
      target.sendInputEvent({ type: "mouseDown", ...point });
      target.sendInputEvent({ type: "mouseUp", ...point });
    },
    { moduleId, ...at },
  );
}

/** A real key press in a module's page, so what follows counts as the user's own click. */
export async function gesture(app: ElectronApplication, moduleId: string): Promise<void> {
  await app.evaluate(({ webContents }, moduleId) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
    if (!target) throw new Error("no panel");
    target.sendInputEvent({ type: "keyDown", keyCode: "Shift" });
    target.sendInputEvent({ type: "keyUp", keyCode: "Shift" });
  }, moduleId);
}

/** Types into the prompt dialog and confirms it. */
export async function answerPrompt(page: Page, value: string): Promise<void> {
  await page.getByTestId("prompt-input").fill(value);
  await page.getByTestId("prompt-submit").click();
  await expect(page.getByTestId("prompt")).toHaveCount(0);
}

/** Right-clicks a workspace in the rail and picks items down the menu. */
export async function fromMenu(page: Page, workspaceId: string, ...items: string[]): Promise<void> {
  await page.getByTestId(`rail-workspace-${workspaceId}`).click({ button: "right" });
  // Closed menus can linger while they animate out, so only look in open ones.
  for (const item of items) await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
}

/** Picks an item from a saved layout's submenu in the Layouts menu. */
export async function layoutMenu(page: Page, name: string, item: string): Promise<void> {
  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"]').getByText(name, { exact: true }).click();
  await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
}

/** A 1x1 PNG. */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/**
 * Puts a small module in a folder of the profile's modules folder (the dev folders Tavora scans) and returns that folder.
 * An `icon` is a file name; the file gets a 1x1 picture.
 */
export async function addModule(
  userData: string,
  folder: string,
  id: string,
  { name = "Mini", version = "1.2.3", icon }: { name?: string; version?: string; icon?: string } = {},
): Promise<string> {
  const dir = path.join(userData, "modules", folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({
      id,
      name,
      version,
      apiVersion: "1",
      entry: "index.html",
      games: [],
      viewport: { minWidth: 100, minHeight: 100 },
      permissions: { network: [] },
      ...(icon ? { icon } : {}),
    }),
  );
  await writeFile(path.join(dir, "index.html"), `<!doctype html><title>${name}</title><p>${name}</p>`);
  if (icon) await writeFile(path.join(dir, icon), PNG);
  return dir;
}

/** Types into a module's shared-note textarea and saves it. */
export async function saveNote(app: ElectronApplication, moduleId: string, text: string, index = 0) {
  await inModule(
    app,
    moduleId,
    `document.querySelector('[data-testid="note"]').value = ${JSON.stringify(text)};
     document.querySelector('[data-testid="save-note"]').click()`,
    index,
  );
}

export async function noteText(app: ElectronApplication, moduleId: string, index = 0): Promise<string> {
  return inModule(app, moduleId, `document.querySelector('[data-testid="note"]').value`, index);
}

/** Runs a function on the Tavora window in the main process. */
export async function onWindow(app: ElectronApplication, action: "hide" | "show" | "minimize" | "restore") {
  await app.evaluate(({ BrowserWindow }, action) => BrowserWindow.getAllWindows()[0]![action](), action);
}

export const NOTES = "tavora.notes";
export const TODOS = "tavora.todos";
export const PLAYGROUND = "tavora.playground";
export const WHITEBOARD = "tavora.whiteboard";
export const PDF_VIEWER = "tavora.pdf-viewer";

/** Types text into whatever has focus in the nth panel of a module, as a user would. */
export async function typeInModule(app: ElectronApplication, moduleId: string, text: string, index = 0): Promise<void> {
  await app.evaluate(
    async ({ webContents }, { moduleId, text, index }) => {
      const target = webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`))
        .sort((a, b) => a.id - b.id)[index];
      if (!target) throw new Error(`no panel ${index} for ${moduleId}`);
      target.focus();
      for (const [i, line] of text.split("\n").entries()) {
        if (i > 0) {
          target.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          target.sendInputEvent({ type: "char", keyCode: "\r" });
          target.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
        }
        if (line) await target.insertText(line);
      }
    },
    { moduleId, text, index },
  );
}

/** Waits until a module's page is shown: its view stays hidden until the page has its data (see ModuleView.revealed). */
export async function waitForShown(app: ElectronApplication, moduleId: string): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }, id) =>
          BrowserWindow.getAllWindows().some((window) =>
            window.contentView.children.some((view) => {
              const contents = (view as unknown as { webContents?: { getURL(): string } }).webContents;
              return !!contents && contents.getURL().startsWith(`tavora-module://${id}/`) && (view as unknown as { getVisible(): boolean }).getVisible();
            }),
          ),
        moduleId,
      ),
    )
    .toBe(true);
}

/**
 * Captures until every picture has something in it: a view that has just been shown can capture empty for a moment.
 * `images` picks the pictures (base64 PNGs) out of what `capture` returns.
 */
async function untilDrawn<T>(capture: () => Promise<T>, images: (shot: T) => string[] = (shot) => shot as string[]): Promise<T> {
  for (let tries = 0; ; tries++) {
    const shot = await capture();
    if (images(shot).every((png) => png.length > 0)) return shot;
    if (tries === 50) throw new Error("a view never drew anything to capture");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Saves a picture of each panel of a module, in the order inModule counts them: `file` itself for one panel,
 * else name-1.png, name-2.png and so on. Returns the files.
 */
export async function shootPanels(app: ElectronApplication, moduleId: string, file: string): Promise<string[]> {
  const images = await untilDrawn(() =>
    app.evaluate(
      async ({ webContents }, id) =>
        Promise.all(
          webContents
            .getAllWebContents()
            .filter((contents) => contents.getURL().startsWith(`tavora-module://${id}/`))
            .sort((a, b) => a.id - b.id)
            .map(async (contents) => (await contents.capturePage()).toPNG().toString("base64")),
        ),
      moduleId,
    ),
  );
  if (images.length === 0) throw new Error(`no panel for ${moduleId}`);
  const files = images.length === 1 ? [file] : images.map((_, i) => file.replace(/(\.png)?$/, `-${i + 1}.png`));
  await Promise.all(images.map((image, i) => writeFile(files[i]!, Buffer.from(image, "base64"))));
  return files;
}

/**
 * Saves a picture of the whole window with its panels. BrowserWindow.capturePage and page.screenshot only see
 * Tavora's own page, where each panel is an empty hole: the panels are separate views on top of it. This captures
 * every shown view too and draws it at its place over the page.
 */
export async function shootWindow(app: ElectronApplication, page: Page, file: string): Promise<void> {
  const capture = () =>
    app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
      const window = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]!;
      const [width, height] = window.getContentSize() as [number, number];
      const png = async (contents: Electron.WebContents) => (await contents.capturePage()).toPNG().toString("base64");
      const layers = [{ png: await png(window.webContents), x: 0, y: 0, width, height }];
      for (const view of window.contentView.children) {
        if (!(view instanceof WebContentsView) || !view.getVisible()) continue;
        const bounds = view.getBounds();
        if (bounds.width > 0 && bounds.height > 0) layers.push({ png: await png(view.webContents), ...bounds });
      }
      return { width, height, layers };
    });
  const { width, height, layers } = await untilDrawn(capture, (shot) => shot.layers.map((layer) => layer.png));
  // Drawn in Tavora's own page, the one place with a canvas at hand.
  const composed = await page.evaluate(
    async ({ width, height, layers }) => {
      const scale = devicePixelRatio;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d")!;
      for (const layer of layers) {
        const bytes = Uint8Array.from(atob(layer.png), (char) => char.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        context.drawImage(image, layer.x * scale, layer.y * scale, layer.width * scale, layer.height * scale);
      }
      return canvas.toDataURL("image/png").split(",")[1]!;
    },
    { width, height, layers },
  );
  await writeFile(file, Buffer.from(composed, "base64"));
}

/** A hover hint's text. The shared tooltip layer moves a `title` into `data-tavora-tooltip` once it shows or changes. */
export function hintOf(locator: import("@playwright/test").Locator): Promise<string | null> {
  return locator.evaluate((element) => element.getAttribute("data-tavora-tooltip") || element.getAttribute("title"));
}
