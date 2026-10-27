import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

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
/** Width of the collapsed game rail. */
export const RAIL_WIDTH = 72;

function seedGame(id: string, name: string, text: string, addedAt: string) {
  return {
    id,
    catalogId: id,
    name,
    icon: { kind: "monogram", text },
    showNews: true,
    addedAt,
    lastPlayedAt: id === "poe2" ? addedAt : null,
    trashedAt: null,
  };
}

/** A library with Path of Exile 2 and Satisfactory that opens on Path of Exile 2. */
export function seedLibrary() {
  const at = "2026-10-01T12:00:00.000Z";
  return {
    version: 1,
    games: {
      poe2: seedGame("poe2", "Path of Exile 2", "PE2", at),
      satisfactory: seedGame("satisfactory", "Satisfactory", "S", at),
    },
    folders: {},
    root: [
      { kind: "game", id: "poe2" },
      { kind: "game", id: "satisfactory" },
    ],
    favorites: [],
    sort: "manual",
    rail: { expanded: false, width: 256 },
    startup: "last-game",
    lastGameId: "poe2",
  };
}

export interface LaunchOptions {
  /** Write the two-game library before the first start (default true). */
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
  expected: string,
  index = 0,
): Promise<void> {
  await expect
    .poll(() =>
      inModule<string | null>(
        app,
        moduleId,
        `document.querySelector('[data-testid="${testId}"]')?.textContent ?? null`,
        index,
      ).catch(() => null),
    )
    .toBe(expected);
}

/** Opens a game from the rail and waits for its workspace. */
export async function openGame(page: Page, gameId: string): Promise<void> {
  await page.getByTestId(`rail-game-${gameId}`).click();
  await expect(page.getByTestId(`rail-game-${gameId}`)).toHaveAttribute("aria-current", "page");
}

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

/** The tabs of open panels, optionally of one module. */
export function panels(page: Page, moduleId?: string) {
  return page.locator(moduleId ? `[data-panel-tab][data-module-id="${moduleId}"]` : "[data-panel-tab]");
}

export async function clickInModule(app: ElectronApplication, moduleId: string, testId: string, index = 0) {
  await inModule(app, moduleId, `document.querySelector('[data-testid="${testId}"]').click()`, index);
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
