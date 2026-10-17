// Module icons: panel tabs, Add module and Settings > Modules show an icon in
// front of the module name. The Appearance switch hides them on the tabs only.
// A module's own icon (the manifest `icon`) wins over the built-in logos, and a
// module with none gets a puzzle piece.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, newUserData, NOTES, openGame, openModule, panels, PLAYGROUND } from "./harness";

const OWN = "local.test.pictured";
const PLAIN = "local.test.plain";
/** A 1x1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function addModule(userData: string, folder: string, id: string, name: string, icon?: string): Promise<void> {
  const dir = path.join(userData, "modules", folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({
      id,
      name,
      version: "1.0.0",
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
}

test("the icons show on tabs and in the module lists, and the switch only hides them on the tabs", async () => {
  const { app, page } = await launch();
  await openGame(page, "poe2");
  await openModule(page, NOTES);

  // On by default: a tab has its icon.
  await expect(panels(page, NOTES).getByTestId("module-icon")).toHaveCount(1);

  // Add module shows the icon of a built-in module.
  await page.getByTestId("add-module").click();
  await expect(page.getByTestId("module-tavora.notes").getByTestId("module-icon")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);

  // Switch them off in Settings > Appearance: the tab loses its icon.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  const toggle = page.getByTestId("module-icons");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(panels(page, NOTES).getByTestId("module-icon")).toHaveCount(0);

  // The module list in Settings keeps its icons.
  await page.getByTestId("settings-nav-modules").click();
  await expect(page.getByTestId("module-tavora.notes").getByTestId("module-icon")).toBeVisible();
  await page.getByTestId("settings-close").click();

  // So does Add module.
  await page.getByTestId("add-module").click();
  await expect(page.getByTestId("module-tavora.notes").getByTestId("module-icon")).toBeVisible();
  await app.close();
});

test("a module's own icon is shown, and a module without one gets a puzzle piece", async () => {
  const userData = await newUserData();
  await addModule(userData, "pictured", OWN, "Pictured", "icon.png");
  await addModule(userData, "plain", PLAIN, "Plain");
  const { app, page } = await launch(userData);
  await openGame(page, "poe2");

  // Add module: the manifest icon is a picture, the plain module's is a drawn icon.
  await page.getByTestId("add-module").click();
  const own = page.getByTestId(`module-${OWN}`).getByTestId("module-icon");
  await expect(own).toHaveJSProperty("tagName", "IMG");
  await expect(own).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.getByTestId(`module-${PLAIN}`).getByTestId("module-icon")).toHaveJSProperty("tagName", "svg");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);

  // The tab of a pictured module shows the same picture.
  await openModule(page, OWN);
  await expect(panels(page, OWN).getByTestId("module-icon")).toHaveAttribute("src", /^data:image\/png;base64,/);

  // Settings > Modules too, and an official module keeps its logo instead of the puzzle piece
  // (the Playground is a development module, so it is listed in Settings > Development).
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await expect(page.getByTestId(`module-${OWN}`).getByTestId("module-icon")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.getByTestId("settings-nav-development").click();
  await expect(page.getByTestId(`module-${PLAYGROUND}`).getByTestId("module-icon")).toHaveJSProperty("tagName", "svg");
  await app.close();
});
