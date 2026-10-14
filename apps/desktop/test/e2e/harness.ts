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
}

export async function launch(
  userData?: string,
  extraModuleDirs: string[] = [],
  { seed = true }: LaunchOptions = {},
): Promise<Running> {
  const dir = userData ?? (await newUserData());
  const libraryFile = path.join(dir, "library.json");
  const exists = await access(libraryFile).then(
    () => true,
    () => false,
  );
  if (seed && !exists) await writeFile(libraryFile, JSON.stringify(seedLibrary()));
  const app = await electron.launch({
    args: [desktopDir],
    env: {
      ...process.env,
      TAVORA_USER_DATA: dir,
      TAVORA_MODULE_DIRS: [path.join(repoRoot, "examples"), FIXTURES, ...extraModuleDirs].join(path.delimiter),
    },
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId("rail")).toBeVisible();
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), WINDOW);
  return { app, page, userData: dir };
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

export async function openModule(page: Page, moduleId: string): Promise<void> {
  await page.click(`[data-testid="open-${moduleId}"]`);
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
