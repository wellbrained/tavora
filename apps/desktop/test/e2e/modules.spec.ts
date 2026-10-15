// Settings > Modules: the list says where each module came from, Reload picks
// up a module put into the player's modules folder and explains one that
// cannot be loaded, and Remove takes a module away together with its panels.
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, newUserData, openGame, openModule, panels } from "./harness";

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
