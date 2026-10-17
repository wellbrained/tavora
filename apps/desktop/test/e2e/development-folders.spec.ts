// Development folders: a module developer adds their project folder in Settings > Modules,
// Tavora loads the module straight from it, and its panels reload when the build changes.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectModuleText, launch, newUserData, openModule, seedLibrary } from "./harness";

const ID = "devtest.tracker";

async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-project-"));
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({ id: ID, name: "Tracker", version: "0.1.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } }),
  );
  await build(dir, "first build");
  return dir;
}

async function build(dir: string, text: string): Promise<void> {
  await mkdir(path.join(dir, "dist"), { recursive: true });
  await writeFile(path.join(dir, "dist", "index.html"), `<!doctype html><meta charset="utf-8"><p data-testid="build">${text}</p>`);
}

test("a development folder loads its module, reloads its panels on a new build, and can be removed", async () => {
  const dir = await project();
  const userData = await newUserData();
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), developmentFolders: [dir, path.join(dir, "not-a-module")] }));
  const { app, page } = await launch(userData);
  try {
    // Settings > Modules lists both folders: one loads the module, the other says why it can't.
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-modules").click();
    const folders = page.getByTestId("development-folder");
    await expect(folders).toHaveCount(2);
    await expect(folders.nth(0).getByTestId("development-folder-status")).toHaveText("Loads Tracker 0.1.0. Its panels reload when the build changes.");
    await expect(folders.nth(1).getByTestId("development-folder-status")).toContainText("there is no tavora.module.json in this folder");
    await expect(page.getByTestId(`module-origin-${ID}`)).toContainText(dir);
    await page.keyboard.press("Escape");

    // It is added like any module and listed under Development.
    await openModule(page, ID);
    await expectModuleText(app, ID, "build", "first build");

    // A new build reloads the open panel by itself.
    await build(dir, "second build");
    await expectModuleText(app, ID, "build", "second build");

    // Removing the folder removes the module; the project itself stays.
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-modules").click();
    await folders.nth(0).getByTestId("remove-development-folder").click();
    await expect(folders).toHaveCount(1);
    await expect(page.getByTestId(`module-${ID}`)).toHaveCount(0);
  } finally {
    await app.close();
  }
});
