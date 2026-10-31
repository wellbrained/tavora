// Settings > Modules: the list says where each module came from, Reload picks
// up a module put into the user's modules folder and explains one that
// cannot be loaded, and Remove takes a module away together with its panels.
import { generateKeyPairSync } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { fingerprint, packModule } from "@tavora/pack";
import { expectModuleText, inModule, launch, newUserData, openWorkspace, openModule, panels, seedLibrary, VANILLA } from "./harness";

/** Picks an entry of the More menu in Settings > Modules, where the rarer ways to add a module sit. */
async function fromMore(page: Page, item: string) {
  await page.getByTestId("modules-more").click();
  await page.locator(`[role="menu"][data-state="open"] [data-testid="${item}"]`).click();
}

async function addModule(userData: string, folder: string, id: string): Promise<string> {
  const dir = path.join(userData, "modules", folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({
      id,
      name: "Mini",
      version: "1.2.3",
      apiVersion: "1",
      entry: "index.html",
      games: [],
      viewport: { minWidth: 100, minHeight: 100 },
      permissions: { network: [] },
    }),
  );
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Mini</title><p>Mini</p>");
  return dir;
}

test("the modules page lists where modules came from, reloads, and removes one with its panels", async () => {
  const userData = await newUserData();
  const mini = await addModule(userData, "mini", "local.test.mini");
  const { app, page } = await launch(userData);

  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await expect(page.getByTestId("module-origin-local.test.mini")).toHaveText("Your modules folder, in mini");
  await page.getByTestId("module-more-local.test.mini").click();
  await expect(page.getByTestId("remove-module-local.test.mini")).toBeVisible();
  await page.keyboard.press("Escape");
  // Tavora's own modules are listed, without a tag (only modules from elsewhere say where they came from), but cannot be removed here.
  await expect(page.getByTestId("module-tavora.notes")).toBeVisible();
  await expect(page.getByTestId("module-tag-tavora.notes")).toHaveCount(0);
  await expect(page.getByTestId("module-origin-tavora.notes")).toHaveCount(0);
  await expect(page.getByTestId("remove-module-tavora.notes")).toHaveCount(0);

  await expect(page.getByTestId("module-problems")).toHaveCount(0);

  // A module added while Tavora runs appears on Reload; a broken one is explained.
  await addModule(userData, "later", "local.test.later");
  await addModule(userData, "duplicate", VANILLA);
  await mkdir(path.join(userData, "modules", "broken"));
  await writeFile(path.join(userData, "modules", "broken", "tavora.module.json"), "{ nope");
  await rm(path.join(await addModule(userData, "unbuilt", "local.test.unbuilt"), "index.html"));
  await expect(page.getByTestId("module-local.test.later")).toHaveCount(0);
  await fromMore(page, "reload-modules");
  await expect(page.getByTestId("module-local.test.later")).toBeVisible();
  await expect(page.getByTestId("module-problems")).toContainText("broken can't load:");
  await expect(page.getByTestId("module-problems")).toContainText("unbuilt can't load, its files aren't built.");
  await expect(page.getByTestId("module-problems")).toContainText(path.join("modules", "unbuilt"));
  await expect(page.getByTestId("open-module-problem-unbuilt")).toBeVisible();

  const warnings = page.getByTestId("module-problems");
  await expect(warnings).toContainText("another module with the same id is already loaded");
  await expect(warnings).toHaveAttribute("aria-live", "polite");
  const warningGroup = page.locator("section").filter({ has: warnings });
  await expect(warningGroup.getByRole("heading", { name: "Modules that could not be loaded", exact: true })).toBeVisible();
  await expect(warningGroup.getByTestId("install-module")).toHaveCount(0);
  await expect(page.locator('[data-setting="own-modules"]').getByTestId("module-problems")).toHaveCount(0);
  await app.evaluate(({ shell }) => {
    shell.openPath = async (folder) => {
      (globalThis as { warningFolder?: string }).warningFolder = folder;
      return "";
    };
  });
  await page.getByRole("button", { name: "Open folder: unbuilt", exact: true }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as { warningFolder?: string }).warningFolder)).toBe(path.join(userData, "modules", "unbuilt"));
  await page.screenshot({ path: "test-results/module-warnings-wide.png" });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(800, 900));
  await expect.poll(() => page.getByRole("dialog", { name: "Settings", exact: true }).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth;
  })).toBe(true);
  await expect(page.getByTestId("open-module-problem-unbuilt")).toBeVisible();
  expect(await warnings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const row of await warnings.getByRole("listitem").all()) {
    const button = await row.getByRole("button").boundingBox();
    for (const text of await row.locator("p").all()) {
      const bounds = await text.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(button!.x);
      expect(await text.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  }
  await page.screenshot({ path: "test-results/module-warnings-narrow.png" });
  // At the smallest window, buttons go under the text instead of running off to the side or squeezing it.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(640, 900));
  await expect
    .poll(() =>
      page.getByRole("dialog", { name: "Settings", exact: true }).evaluate((dialog) =>
        Array.from(dialog.querySelectorAll("*")).every((element) => !/auto|scroll/.test(getComputedStyle(element).overflowX) || element.scrollWidth <= element.clientWidth),
      ),
    )
    .toBe(true);
  const unbuilt = warnings.getByRole("listitem").filter({ hasText: "unbuilt can't load" });
  await expect
    .poll(async () => (await unbuilt.getByRole("button").boundingBox())!.y > (await unbuilt.getByTestId("module-problem-path").boundingBox())!.y)
    .toBe(true);
  expect((await page.getByTestId("module-tavora.notes").getByText("Notes", { exact: true }).boundingBox())!.width).toBeGreaterThan(20);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1400, 900));
  await rm(path.join(userData, "modules", "broken"), { recursive: true });
  await rm(path.join(userData, "modules", "unbuilt"), { recursive: true });
  await rm(path.join(userData, "modules", "duplicate"), { recursive: true });
  await fromMore(page, "reload-modules");
  await expect(warnings).toHaveCount(0);

  // Open a panel of the module in a game, then remove the module.
  await page.getByTestId("settings-close").click();
  await openWorkspace(page, "poe2");
  await openModule(page, "local.test.mini");
  await expect(panels(page, "local.test.mini")).toHaveCount(1);
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await page.getByTestId("module-more-local.test.mini").click();
  await page.getByTestId("remove-module-local.test.mini").click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("module-local.test.mini")).toHaveCount(0);
  await expect(page.getByTestId("module-local.test.later")).toBeVisible();
  await page.getByTestId("settings-close").click();
  await expect(panels(page, "local.test.mini")).toHaveCount(0);
  await expect(access(mini)).rejects.toThrow();
  await app.close();
});

test("data saved before modules had owners is moved under its owner and still found (S5)", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "status", "Connected");
  await inModule(app, VANILLA, `document.querySelector('[data-testid="increment"]').click()`);
  await expectModuleText(app, VANILLA, "count", "1");
  await inModule(app, VANILLA, "localStorage.setItem('kept', 'yes')");
  await app.close();

  // Put both back the way older versions saved them: keyed by the id alone.
  const data = path.join(userData, "module-data");
  expect(await readdir(data)).toEqual(["local"]);
  await rename(path.join(data, "local", VANILLA), path.join(data, VANILLA));
  const partitions = path.join(userData, "Partitions");
  const owned = (await readdir(partitions)).filter((name) => name.startsWith(`module%3Alocal%3A${VANILLA}@`));
  expect(owned).toHaveLength(1);
  await rename(path.join(partitions, owned[0]!), path.join(partitions, owned[0]!.replace("%3Alocal%3A", "%3A")));

  const again = await launch(userData);
  await expectModuleText(again.app, VANILLA, "count", "1");
  expect(await inModule(again.app, VANILLA, "localStorage.getItem('kept')")).toBe("yes");
  expect(await readdir(data)).toEqual(["local"]);
  await again.app.close();
});

/** Makes the next file dialog answer with this file, as if the user picked it (null: cancelled), and keeps the folder it opened in. */
async function pickFile(app: ElectronApplication, file: string | null) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async (_window: unknown, options: { defaultPath?: string }) => {
      (globalThis as { openedIn?: string | null }).openedIn = options.defaultPath ?? null;
      return picked === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [picked] };
    }) as unknown as typeof dialog.showOpenDialog;
  }, file);
}

/** The folder the last file dialog opened in, or null for the system's choice. */
async function openedIn(app: ElectronApplication): Promise<string | null> {
  return app.evaluate(() => (globalThis as { openedIn?: string | null }).openedIn ?? null);
}

test("a signed zip installs from Settings, updates only from its publisher, and a copycat is refused (S5)", async () => {
  const userData = await newUserData();
  const work = path.join(userData, "..", `${path.basename(userData)}-zips`);
  const source = path.dirname(await addModule(work, "mini", "wellbrained.mini"));
  const key = generateKeyPairSync("ed25519").privateKey;
  const zip = path.join(work, "mini.zip");
  await writeFile(zip, (await packModule(path.join(source, "mini"), key)).zip);

  const { app, page } = await launch(userData);
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await pickFile(app, zip);
  await fromMore(page, "install-module");
  await expect(page.getByTestId("module-wellbrained.mini")).toBeVisible();
  await expect(page.getByTestId("module-publisher-wellbrained.mini")).toBeVisible();
  await expect(page.getByTestId("module-origin-wellbrained.mini")).toContainText("wellbrained.mini");

  // The same id signed by someone else cannot replace it. The dialog opens where the last zip came from.
  await mkdir(path.join(work, "other"));
  const copycat = path.join(work, "other", "copycat.zip");
  await writeFile(copycat, (await packModule(path.join(source, "mini"), generateKeyPairSync("ed25519").privateKey)).zip);
  await pickFile(app, copycat);
  await fromMore(page, "install-module");
  await expect(page.getByTestId("toast").getByText("comes from a different publisher")).toBeVisible();
  expect(await openedIn(app)).toBe(path.resolve(work));

  // Only a zip that installed moves it.
  await pickFile(app, null);
  await fromMore(page, "install-module");
  await expect.poll(() => openedIn(app)).toBe(path.resolve(work));
  await app.close();
});

test("data left by modules that are gone is listed and deleted, and a local copy's data moves to the signed module (S5)", async () => {
  const userData = await newUserData();
  const seed = async (owner: string, id: string, body: string) => {
    await mkdir(path.join(userData, "module-data", owner, id, "poe2"), { recursive: true });
    await writeFile(path.join(userData, "module-data", owner, id, "poe2", "storage.json"), body);
  };
  await seed("local", "wellbrained.gone", '{"version":1,"entries":{}}');
  await seed("local", "wellbrained.mini", '{"version":1,"entries":{"count":7}}');

  const work = path.join(userData, "..", `${path.basename(userData)}-zips`);
  const source = path.dirname(await addModule(work, "mini", "wellbrained.mini"));
  const key = generateKeyPairSync("ed25519").privateKey;
  const zip = path.join(work, "mini.zip");
  await writeFile(zip, (await packModule(path.join(source, "mini"), key)).zip);

  const { app, page } = await launch(userData);
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await openLeftover(page);
  await expect(page.getByTestId("leftover-local-wellbrained.gone")).toBeVisible();
  await page.getByTestId("delete-data-local-wellbrained.gone").click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("leftover-local-wellbrained.gone")).toHaveCount(0);
  expect(await exists(path.join(userData, "module-data", "local", "wellbrained.gone"))).toBe(false);

  await pickFile(app, zip);
  await fromMore(page, "install-module");
  await expect(page.getByTestId("module-publisher-wellbrained.mini")).toBeVisible();
  // Installing never hands data over; the local copy's data waits and is offered.
  await openLeftover(page);
  await expect(page.getByTestId("leftover-local-wellbrained.mini")).toBeVisible();
  expect(await exists(path.join(userData, "module-data", fingerprint(key)))).toBe(false);

  await app.evaluate(({ app: electronApp }) => {
    electronApp.relaunch = () => undefined;
  });
  const closed = app.waitForEvent("close");
  await page.getByTestId("module-more-wellbrained.mini").click();
  await page.getByTestId("move-local-data-wellbrained.mini").click();
  await page.getByTestId("confirm-submit").click();
  await closed;

  const again = await launch(userData);
  const moved = path.join(userData, "module-data", fingerprint(key), "wellbrained.mini", "poe2", "storage.json");
  expect(JSON.parse(await readFile(moved, "utf8")).entries.count).toBe(7);
  await again.page.getByTestId("rail-settings").click();
  await again.page.getByTestId("settings-nav-modules").click();
  await expect(again.page.getByTestId("module-publisher-wellbrained.mini")).toBeVisible();
  await expect(again.page.getByTestId("leftover-local-wellbrained.mini")).toHaveCount(0);
  await expect(again.page.getByTestId("move-local-data-wellbrained.mini")).toHaveCount(0);
  await again.app.close();
});

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

test("the pictures folder shows the default place, and a folder that is gone is reported and can be left", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await expect(page.getByTestId("module-files-path")).toHaveText(path.join(userData, "module-blobs"));
  await expect(page.getByTestId("reset-module-files")).toHaveCount(0);
  await expect(page.getByTestId("open-module-files")).toBeVisible();
  await app.close();
});

test("a pictures folder that moved to a drive that is gone gives a notice; Use default brings the pictures back", async () => {
  const userData = await newUserData();
  const gone = path.join(userData, "unplugged", "Tavora module files");
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), moduleFilesFolder: gone }));

  // The drive is not there: Tavora says so and shows the pictures as missing; nothing is created or deleted.
  let running = await launch(userData);
  await expect(running.page.getByTestId("notice")).toContainText("cannot be found");
  await running.page.getByTestId("rail-settings").click();
  await running.page.getByTestId("settings-nav-modules").click();
  await expect(running.page.getByTestId("module-files-path")).toContainText(gone);
  await expect(running.page.getByTestId("module-files-path")).toContainText("Can't find this folder");
  await running.app.close();
  await expect(access(path.dirname(gone))).rejects.toThrow();

  // The drive comes back with a picture on it; Use default copies it into Tavora's folder and removes it there.
  const id = "0123456789abcdef0123456789abcdef";
  await mkdir(path.join(gone, "tavora.notes", "poe2"), { recursive: true });
  await writeFile(path.join(gone, "tavora.notes", "poe2", `${id}.png`), "picture");
  running = await launch(userData);
  await running.page.getByTestId("rail-settings").click();
  await running.page.getByTestId("settings-nav-modules").click();
  await expect(running.page.getByTestId("module-files-path")).toHaveText(gone);
  await running.page.getByTestId("reset-module-files").click();
  await expect(running.page.getByTestId("module-files-path")).toHaveText(path.join(userData, "module-blobs"));
  // Saved there before modules had owners, so it was moved under its owner at start.
  expect(await readdir(path.join(userData, "module-blobs", "official", "tavora.notes", "poe2"))).toEqual([`${id}.png`]);
  expect(await readdir(gone)).toEqual([]);
  await expect(running.page.getByTestId("reset-module-files")).toHaveCount(0);
  await running.app.close();
});

test("a module's patch notes show in Settings, and an update marks the new ones until they are read", async () => {
  const userData = await newUserData();
  const work = path.join(userData, "..", `${path.basename(userData)}-notes`);
  const dir = await addModule(work, "mini", "wellbrained.mini");
  const key = generateKeyPairSync("ed25519").privateKey;
  async function release(version: string, changelog: { version: string; notes: string[] }[]): Promise<string> {
    const manifest = JSON.parse(await readFile(path.join(dir, "tavora.module.json"), "utf8"));
    await writeFile(path.join(dir, "tavora.module.json"), JSON.stringify({ ...manifest, version, changelog: "changelog.json" }));
    await writeFile(path.join(dir, "changelog.json"), JSON.stringify(changelog));
    const zip = path.join(work, `mini-${version}.zip`);
    await writeFile(zip, (await packModule(dir, key)).zip);
    return zip;
  }
  const first = await release("1.0.0", [{ version: "1.0.0", notes: ["First version."] }]);

  const { app, page } = await launch(userData);
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await pickFile(app, first);
  await fromMore(page, "install-module");
  // A fresh install has nothing new to read.
  await expect(page.getByTestId("module-notes-toggle-wellbrained.mini")).toBeVisible();
  await expect(page.getByTestId("module-notes-new-wellbrained.mini")).toHaveCount(0);

  const second = await release("1.1.0", [
    { version: "1.1.0", notes: ["<b>Filters</b> by tag."] },
    { version: "1.0.0", notes: ["First version."] },
  ]);
  await pickFile(app, second);
  await fromMore(page, "install-module");
  await expect(page.getByTestId("module-notes-new-wellbrained.mini")).toBeVisible();
  await page.getByTestId("module-notes-toggle-wellbrained.mini").click();
  // Newest first, as plain text.
  await expect(page.getByTestId("module-notes-wellbrained.mini-1.1.0")).toContainText("<b>Filters</b> by tag.");
  await expect(page.getByTestId("module-notes-wellbrained.mini-1.0.0")).toContainText("First version.");
  await expect(page.getByTestId("module-notes-new-wellbrained.mini")).toHaveCount(0);
  // They open in a dialog over Settings; Escape closes only the dialog.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("module-notes-dialog-wellbrained.mini")).toHaveCount(0);
  await expect(page.getByTestId("settings-nav-modules")).toBeVisible();

  // Tavora's own modules have patch notes too.
  await expect(page.getByTestId("module-notes-toggle-tavora.notes")).toBeVisible();
  await app.close();
});

/** Opens the data removed modules left behind, a list folded into its row on Settings > Modules. */
async function openLeftover(page: import("@playwright/test").Page) {
  const toggle = page.getByTestId("leftover-data-toggle");
  if ((await toggle.getAttribute("data-state")) !== "open") await toggle.click();
}
