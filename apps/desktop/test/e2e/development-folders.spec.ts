// Development folders: a module developer adds their project folder (or a folder of projects) in Settings > Development,
// Tavora loads the module straight from it, and its panels reload when the build changes.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectModuleText, hintOf, launch, newUserData, openGame, openModule, PLAYGROUND, seedLibrary, VUE } from "./harness";

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
    // Settings > Development lists both folders: one with its module under it, the other says why it can't.
    // The module is listed once, under its folder, which already says where it comes from.
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-development").click();
    const folders = page.getByTestId("development-folder");
    await expect(folders).toHaveCount(2);
    await expect(folders.nth(0).getByTestId(`module-${ID}`)).toContainText("Tracker");
    await expect(folders.nth(0).getByTestId("development-project")).toHaveCount(0);
    await expect(folders.nth(1).getByTestId("development-folder-status")).toHaveText("This folder can't be found.");
    await expect(page.getByTestId(`module-${ID}`)).toHaveCount(1);
    await expect(page.getByTestId(`module-origin-${ID}`)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // It is added like any module and listed under Development.
    await openGame(page, "poe2");
    await openModule(page, ID);
    await expectModuleText(app, ID, "build", "first build");

    // A new build reloads the open panel by itself.
    await build(dir, "second build");
    await expectModuleText(app, ID, "build", "second build");

    // While its build is gone (a watcher rebuilding it), the panel waits instead of being removed, also over a
    // restart, and starts again with the next build. A rebuild empties the build folder, as Vite does.
    await rm(path.join(dir, "dist", "index.html"));
    await expect(page.locator('[data-testid^="panel-module-waiting-"]')).toContainText("Tracker can't load right now");
  } finally {
    await app.close();
  }
  const waiting = await launch(userData);
  try {
    await openGame(waiting.page, "poe2");
    await expect(waiting.page.locator('[data-testid^="panel-module-waiting-"]')).toContainText("Tracker can't load right now");
    await build(dir, "third build");
    await expectModuleText(waiting.app, ID, "build", "third build");
  } finally {
    await waiting.app.close();
  }

  const last = await launch(userData);
  try {
    const folders = last.page.getByTestId("development-folder");
    // Removing the folder removes the module; the project itself stays.
    await last.page.getByTestId("rail-settings").click();
    await last.page.getByTestId("settings-nav-development").click();
    await folders.nth(0).getByTestId("remove-development-folder").click();
    await last.page.getByTestId("confirm-submit").click();
    await expect(folders).toHaveCount(1);
    await expect(last.page.getByTestId(`module-${ID}`)).toHaveCount(0);
  } finally {
    await last.app.close();
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
    const folder = page.getByTestId("development-folder");
    const waiting = folder.getByTestId("development-project");
    await expect(folder.getByTestId("module-devtest.planner")).toBeVisible();
    await expect(waiting).toHaveCount(1);
    await expect(waiting.getByTestId("development-project-status")).toHaveText("Not built yet. Run npm run dev in tracker and leave it running.");
    // It still looks like a module, named from its manifest, and its folder can be opened.
    await expect(waiting.getByTestId("development-project-name")).toHaveText("Tracker");
    await expect(waiting.getByTestId("open-project")).toBeVisible();
    await expect(folder.getByTestId("open-project-devtest.planner")).toBeVisible();

    // Building it loads it, and a project made in the folder later shows up by itself.
    await build(path.join(workspace, "tracker"), "Tracker");
    await expect(folder.getByTestId("module-devtest.tracker")).toBeVisible();
    await expect(waiting).toHaveCount(0);
    await make("notes", "devtest.notes", "Notes Dev", true);
    await expect(folder.getByTestId("module-devtest.notes")).toBeVisible();
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

const VANILLA = "local.example.vanilla-module";

test("an example is copied into a project folder as a new project of its own", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "tavora-workspace-"));
  const userData = await newUserData();
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), developmentFolders: [workspace] }));
  const { app, page } = await launch(userData);
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-development").click();

    // The examples have their own list; the UI Playground isn't one of them.
    const examples = page.getByTestId("development-examples");
    await expect(examples.getByTestId(`module-${VUE}`)).toBeVisible();
    await expect(examples.getByTestId(`module-${PLAYGROUND}`)).toHaveCount(0);

    // Make a copy offers the project folder, and names the module for the player to change.
    await page.getByTestId(`copy-example-${VANILLA}`).click();
    const dialog = page.getByTestId("copy-example-dialog");
    await expect(page.getByTestId("copy-example-name")).toHaveValue("My Module");
    await expect(dialog.getByTestId("copy-example-folder")).toHaveAttribute("data-state", "checked");
    await page.getByTestId("copy-example-name").fill("Boss Timer");
    await page.getByTestId("copy-example-submit").click();
    await expect(dialog).toHaveCount(0);

    // The copy is a project in that folder, waiting for its first build, with an id of its own.
    const project = path.join(workspace, "boss-timer");
    const waiting = page.getByTestId("development-folder").getByTestId("development-project");
    await expect(waiting.getByTestId("development-project-status")).toHaveText("Not built yet. Run npm run dev in boss-timer and leave it running.");
    const manifest = JSON.parse(await readFile(path.join(project, "tavora.module.json"), "utf8")) as { id: string; name: string };
    expect(manifest).toMatchObject({ id: "local.boss-timer", name: "Boss Timer" });
    expect(await readFile(path.join(project, "package.json"), "utf8")).not.toContain("workspace:");

    // Its build loads it from there, next to the example it came from.
    await mkdir(path.join(project, "dist"), { recursive: true });
    await writeFile(path.join(project, "dist", "index.html"), "<!doctype html><title>Boss Timer</title>");
    await expect(page.getByTestId("development-folder").getByTestId("module-local.boss-timer")).toBeVisible();
    await expect(examples.getByTestId(`module-${VANILLA}`)).toBeVisible();

    // The same name again is refused, and nothing is copied.
    await page.getByTestId(`copy-example-${VANILLA}`).click();
    await page.getByTestId("copy-example-name").fill("Boss Timer");
    await page.getByTestId("copy-example-submit").click();
    await expect(page.getByTestId("copy-example-error")).toHaveText("You already have a module with the id local.boss-timer. Pick another name.");
  } finally {
    await app.close();
  }
});

test("an example copied into another folder adds its project as a project folder", async () => {
  const elsewhere = await mkdtemp(path.join(tmpdir(), "tavora-elsewhere-"));
  const { app, page } = await launch();
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-development").click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog;
    }, elsewhere);

    // Without project folders there is nothing to choose: the folder is picked after Copy.
    await page.getByTestId(`copy-example-${VUE}`).click();
    await expect(page.getByTestId("copy-example-folder")).toHaveCount(0);
    await expect(page.getByTestId("copy-example-name")).toHaveValue("My Vue Module");
    await page.getByTestId("copy-example-submit").click();
    await expect(page.getByTestId("copy-example-dialog")).toHaveCount(0);

    const folders = page.getByTestId("development-folder");
    await expect(folders).toHaveCount(1);
    await expect.poll(() => hintOf(folders.getByTestId("development-folder-path"))).toBe(path.join(elsewhere, "my-vue-module"));
    await expect(folders.getByTestId("development-project-status")).toHaveText("Not built yet. Run npm run dev in my-vue-module and leave it running.");
  } finally {
    await app.close();
  }
});
