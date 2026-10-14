import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
export const desktopDir = path.resolve(here, "../..");
const repoRoot = path.resolve(desktopDir, "../..");

export const VANILLA = "local.example.vanilla-module";
export const REACT = "local.example.react-module";
export const HOSTILE = "local.test.hostile-module";

export interface Running {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

export async function newUserData(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tavora-e2e-"));
}

export async function launch(userData?: string): Promise<Running> {
  const dir = userData ?? (await newUserData());
  const app = await electron.launch({
    args: [desktopDir],
    env: {
      ...process.env,
      TAVORA_USER_DATA: dir,
      TAVORA_MODULE_DIRS: [path.join(repoRoot, "examples"), path.join(desktopDir, "test/fixtures")].join(path.delimiter),
    },
  });
  const page = await app.firstWindow();
  await expect(page.locator('[data-testid="game-select"] option')).toHaveCount(2);
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

export async function openModule(page: Page, moduleId: string): Promise<void> {
  await page.click(`[data-testid="open-${moduleId}"]`);
}

export function panels(page: Page, moduleId?: string) {
  return page.locator(moduleId ? `.header[data-module-id="${moduleId}"]` : ".header");
}

export async function clickInModule(app: ElectronApplication, moduleId: string, testId: string, index = 0) {
  await inModule(app, moduleId, `document.querySelector('[data-testid="${testId}"]').click()`, index);
}
