// Data saved before the Game → Workspace rename (Tavora 0.21.41 and older) opens as it was: the move at start
// renames it (main/workspace-move.ts) and keeps the files as they were in backups/before-workspaces.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, newUserData, NOTES, panels } from "./harness";

const NOTES_PANEL = "dddddddd-0000-4000-8000-000000000001";
const at = "2026-10-01T12:00:00.000Z";
const oldEntry = (id: string, name: string, kind: "game" | "workspace") => ({
  id,
  kind,
  catalogId: kind === "game" ? id : null,
  name,
  icon: { kind: "monogram", text: name.slice(0, 2).toUpperCase() },
  useOriginalIcon: kind === "game",
  steamAppId: null,
  iconFile: null,
  iconCheckedAt: null,
  iconSharedAt: null,
  showNews: kind === "game",
  addedAt: at,
  lastPlayedAt: kind === "workspace" ? at : null,
  trashedAt: null,
});

test("data from before the workspace names opens with every workspace, its panels and the last one open", async () => {
  const userData = await newUserData();
  await writeFile(
    path.join(userData, "library.json"),
    JSON.stringify({
      version: 1,
      games: { poe2: oldEntry("poe2", "Path of Exile 2", "game"), "local-personal": oldEntry("local-personal", "Personal", "workspace") },
      folders: {},
      root: [
        { kind: "game", id: "poe2" },
        { kind: "game", id: "local-personal" },
      ],
      favorites: [],
      sort: "manual",
      rail: { expanded: false, width: 256 },
      startup: "last-game",
      gameEndWorkspace: "local-personal",
      onboarded: true,
      lastGameId: "local-personal",
    }),
  );
  await writeFile(
    path.join(userData, "workspace.json"),
    JSON.stringify({ version: 2, games: { "local-personal": { instances: [{ instanceId: NOTES_PANEL, moduleId: NOTES }], layout: null, snapshots: [] } } }),
  );

  const { app, page } = await launch(userData);
  try {
    // The personal workspace was the last one open, with its Notes panel.
    await expect(page.getByTestId("rail-workspace-local-personal")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("rail-workspace-poe2")).toBeVisible();
    await expect(panels(page, NOTES)).toHaveCount(1);
    await page.getByTestId("rail-workspace-local-personal").click({ button: "right" });
    await expect(page.locator('[role="menu"][data-state="open"] [data-testid="menu-remove"]')).toHaveText("Remove workspace…");
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
  }

  const library = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8"));
  expect(library).toMatchObject({ version: 2, startup: "last-workspace", lastWorkspaceId: "local-personal", gameEndWorkspaceId: "local-personal" });
  expect(library.workspaces["local-personal"].kind).toBe("personal");
  expect(library).not.toHaveProperty("games");
  const workspace = JSON.parse(await readFile(path.join(userData, "workspace.json"), "utf8"));
  expect(workspace.version).toBe(3);
  expect(workspace.workspaces["local-personal"].instances).toEqual([{ instanceId: NOTES_PANEL, moduleId: NOTES }]);
  expect((await readdir(path.join(userData, "backups", "before-workspaces"))).sort()).toEqual(["library.json", "workspace.json"]);
});
