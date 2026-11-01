// Personal workspaces: places on the rail that belong to no game, for modules such as Notes.
// Only modules for any game are offered there, unless a module opts out with `"workspaces": false`.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, newUserData, openModule, panels, seedLibrary } from "./harness";

async function project(id: string, manifest: { games: string[]; workspaces?: boolean }): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-project-"));
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({ id, name: id, version: "0.1.0", apiVersion: "1", entry: "dist/index.html", ...manifest, viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } }),
  );
  await mkdir(path.join(dir, "dist"), { recursive: true });
  await writeFile(path.join(dir, "dist", "index.html"), `<!doctype html><meta charset="utf-8"><p>${id}</p>`);
  return dir;
}

test("a personal workspace offers only modules for any game, and is worded as a workspace", async () => {
  const forOneGame = await project("devtest.tracker", { games: ["satisfactory"] });
  const needsAGame = await project("devtest.overlay", { games: [], workspaces: false });
  const userData = await newUserData();
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), developmentFolders: [forOneGame, needsAGame] }));
  const { app, page } = await launch(userData);
  try {
    // The rail's Add button offers a personal workspace next to a game.
    await page.getByTestId("rail-add-game").click();
    await page.locator('[role="menu"][data-state="open"] [data-testid="rail-add-personal-item"]').click();
    await page.getByTestId("personal-name").fill("Personal");
    await page.getByTestId("create-personal").click();
    await expect(page.getByTestId("rail-workspace-local-personal")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("empty-workspace")).toBeVisible();

    // Notes is for any game, so it is offered; the module for one game and the one that opted out are not.
    await page.getByTestId("add-module").click();
    await expect(page.getByTestId("module-tavora.notes")).toBeVisible();
    await expect(page.getByTestId("module-devtest.tracker")).toHaveCount(0);
    await expect(page.getByTestId("module-devtest.overlay")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await openModule(page, "tavora.notes");
    await expect(panels(page, "tavora.notes")).toHaveCount(1);

    // A workspace has no icon of its own to go back to, and its removal says what goes.
    await page.getByTestId("rail-workspace-local-personal").click({ button: "right" });
    await page.locator('[role="menu"][data-state="open"] [data-testid="menu-icon"]').click();
    await expect(page.locator('[role="menu"][data-state="open"] [data-testid="menu-icon-label"]')).toBeVisible();
    await expect(page.locator('[data-testid="menu-icon-original"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByTestId("rail-workspace-local-personal").click({ button: "right" });
    await expect(page.locator('[role="menu"][data-state="open"] [data-testid="menu-remove"]')).toHaveText("Remove workspace…");
  } finally {
    await app.close();
  }
});
