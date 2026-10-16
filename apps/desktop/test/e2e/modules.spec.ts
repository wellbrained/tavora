// Settings > Modules: the list says where each module came from, Reload picks
// up a module put into the player's modules folder and explains one that
// cannot be loaded, and Remove takes a module away together with its panels.
import { generateKeyPairSync } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { fingerprint, packModule } from "@tavora/pack";
import { expectModuleText, inModule, launch, newUserData, openGame, openModule, panels, VANILLA } from "./harness";

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
  await expect(page.getByTestId("remove-module-local.test.mini")).toBeVisible();
  // Tavora's own modules are listed but cannot be removed here.
  await expect(page.getByTestId("module-origin-tavora.notes")).toHaveText("Ships with Tavora");
  await expect(page.getByTestId("remove-module-tavora.notes")).toHaveCount(0);

  // A module added while Tavora runs appears on Reload; a broken one is explained.
  await addModule(userData, "later", "local.test.later");
  await mkdir(path.join(userData, "modules", "broken"));
  await writeFile(path.join(userData, "modules", "broken", "tavora.module.json"), "{ nope");
  await expect(page.getByTestId("module-local.test.later")).toHaveCount(0);
  await page.getByTestId("reload-modules").click();
  await expect(page.getByTestId("module-local.test.later")).toBeVisible();
  await expect(page.getByTestId("module-problems")).toContainText("broken");

  // Open a panel of the module in a game, then remove the module.
  await page.getByTestId("settings-close").click();
  await openGame(page, "poe2");
  await openModule(page, "local.test.mini");
  await expect(panels(page, "local.test.mini")).toHaveCount(1);
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
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

/** Makes the next file dialog answer with this file, as if the player picked it. */
async function pickFile(app: ElectronApplication, file: string) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog;
  }, file);
}

test("a signed zip installs from Settings, updates only from its publisher, and a copycat is refused (S5)", async () => {
  const userData = await newUserData();
  const work = path.join(userData, "..", `${path.basename(userData)}-zips`);
  const source = path.dirname(await addModule(work, "mini", "nik.mini"));
  const key = generateKeyPairSync("ed25519").privateKey;
  const zip = path.join(work, "mini.zip");
  await writeFile(zip, (await packModule(path.join(source, "mini"), key)).zip);

  const { app, page } = await launch(userData);
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await pickFile(app, zip);
  await page.getByTestId("install-module").click();
  await expect(page.getByTestId("module-nik.mini")).toBeVisible();
  await expect(page.getByTestId("module-publisher-nik.mini")).toBeVisible();
  await expect(page.getByTestId("module-origin-nik.mini")).toContainText("nik.mini");

  // The same id signed by someone else cannot replace it.
  const copycat = path.join(work, "copycat.zip");
  await writeFile(copycat, (await packModule(path.join(source, "mini"), generateKeyPairSync("ed25519").privateKey)).zip);
  await pickFile(app, copycat);
  await page.getByTestId("install-module").click();
  await expect(page.getByText("comes from a different publisher")).toBeVisible();
  await app.close();
});

test("data left by modules that are gone is listed and deleted, and a local copy's data moves to the signed module (S5)", async () => {
  const userData = await newUserData();
  const seed = async (owner: string, id: string, body: string) => {
    await mkdir(path.join(userData, "module-data", owner, id, "poe2"), { recursive: true });
    await writeFile(path.join(userData, "module-data", owner, id, "poe2", "storage.json"), body);
  };
  await seed("local", "nik.gone", '{"version":1,"entries":{}}');
  await seed("local", "nik.mini", '{"version":1,"entries":{"count":7}}');

  const work = path.join(userData, "..", `${path.basename(userData)}-zips`);
  const source = path.dirname(await addModule(work, "mini", "nik.mini"));
  const key = generateKeyPairSync("ed25519").privateKey;
  const zip = path.join(work, "mini.zip");
  await writeFile(zip, (await packModule(path.join(source, "mini"), key)).zip);

  const { app, page } = await launch(userData);
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await expect(page.getByTestId("leftover-local-nik.gone")).toBeVisible();
  await page.getByTestId("delete-data-local-nik.gone").click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("leftover-local-nik.gone")).toHaveCount(0);
  expect(await exists(path.join(userData, "module-data", "local", "nik.gone"))).toBe(false);

  await pickFile(app, zip);
  await page.getByTestId("install-module").click();
  await expect(page.getByTestId("module-publisher-nik.mini")).toBeVisible();
  // Installing never hands data over; the local copy's data waits and is offered.
  await expect(page.getByTestId("leftover-local-nik.mini")).toBeVisible();
  expect(await exists(path.join(userData, "module-data", fingerprint(key)))).toBe(false);

  await app.evaluate(({ app: electronApp }) => {
    electronApp.relaunch = () => undefined;
  });
  const closed = app.waitForEvent("close");
  await page.getByTestId("move-local-data-nik.mini").click();
  await page.getByTestId("confirm-submit").click();
  await closed;

  const again = await launch(userData);
  const moved = path.join(userData, "module-data", fingerprint(key), "nik.mini", "poe2", "storage.json");
  expect(JSON.parse(await readFile(moved, "utf8")).entries.count).toBe(7);
  await again.page.getByTestId("rail-settings").click();
  await again.page.getByTestId("settings-nav-modules").click();
  await expect(again.page.getByTestId("module-publisher-nik.mini")).toBeVisible();
  await expect(again.page.getByTestId("leftover-local-nik.mini")).toHaveCount(0);
  await expect(again.page.getByTestId("move-local-data-nik.mini")).toHaveCount(0);
  await again.app.close();
});

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}
