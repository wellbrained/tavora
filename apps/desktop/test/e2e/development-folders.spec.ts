// Development folders: a module developer adds their project folder (or a folder of projects) in Settings > Development,
// Tavora loads the module straight from it, and its panels reload when the build changes.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectModuleText, launch, newUserData, openGame, openModule, seedLibrary } from "./harness";

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
    // Settings > Development lists both folders: one loads the module, the other says why it can't.
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-development").click();
    const folders = page.getByTestId("development-folder");
    await expect(folders).toHaveCount(2);
    await expect(folders.nth(0).getByTestId("development-project-status")).toHaveText("Loads Tracker 0.1.0. Its panels reload when the build changes.");
    await expect(folders.nth(1).getByTestId("development-folder-status")).toHaveText("This folder can't be found.");
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
    await page.getByTestId("settings-nav-development").click();
    await folders.nth(0).getByTestId("remove-development-folder").click();
    await expect(folders).toHaveCount(1);
    await expect(page.getByTestId(`module-${ID}`)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("a folder of projects loads every project in it, says which still needs a build, and finds a new one", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "tavora-workspace-"));
  const manifest = (id: string, name: string) =>
    JSON.stringify({ id, name, version: "0.1.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } });
  const make = async (folder: string, id: string, name: string, built: boolean) => {
    await mkdir(path.join(workspace, folder), { recursive: true });
    await writeFile(path.join(workspace, folder, "tavora.module.json"), manifest(id, name));
    if (built) await build(path.join(workspace, folder), name);
  };
  await make("planner", "devtest.planner", "Planner", true);
  await make("tracker", "devtest.tracker", "Tracker", false);
  const userData = await newUserData();
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), developmentFolders: [workspace] }));
  const { app, page } = await launch(userData);
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-development").click();
    const projects = page.getByTestId("development-folder").getByTestId("development-project");
    await expect(projects).toHaveCount(2);
    await expect(projects.nth(0).getByTestId("development-project-status")).toHaveText("Loads Planner 0.1.0. Its panels reload when the build changes.");
    await expect(projects.nth(1).getByTestId("development-project-status")).toHaveText("Not built yet. Run npm run dev in tracker and leave it running.");

    // Building it loads it, and a project made in the folder later shows up by itself.
    await build(path.join(workspace, "tracker"), "Tracker");
    await expect(projects.nth(1).getByTestId("development-project-status")).toHaveText("Loads Tracker 0.1.0. Its panels reload when the build changes.");
    await make("notes", "devtest.notes", "Notes Dev", true);
    await expect(projects).toHaveCount(3);
    await expect(page.getByTestId("module-devtest.notes")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("a module made for one game is listed in Add module only in that game", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-project-"));
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({ id: ID, name: "Tracker", version: "0.1.0", apiVersion: "1", entry: "dist/index.html", games: ["satisfactory"], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } }),
  );
  await build(dir, "first build");
  const userData = await newUserData();
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), developmentFolders: [dir] }));
  const { app, page } = await launch(userData);
  try {
    // Path of Exile 2 is shown first: the module is not in its library at all.
    await page.getByTestId("add-module").click();
    await expect(page.getByTestId("add-module-dialog")).toBeVisible();
    await expect(page.getByTestId(`module-${ID}`)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // In Satisfactory it is listed and opens.
    await openGame(page, "satisfactory");
    await openModule(page, ID);
    await expectModuleText(app, ID, "build", "first build");
  } finally {
    await app.close();
  }
});
