// Release copies in Settings > Development say what the catalog still lacks: a "New version" badge when the
// copy is newer, "Not published yet" when the catalog has no such module, nothing when it is up to date or the
// catalog can't be reached, and the Settings sidebar counts the ones with a badge.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, newUserData, seedLibrary } from "./harness";

async function copy(id: string, version: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-release-"));
  await mkdir(path.join(dir, "dist"));
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({ id, name: id.split(".")[1], version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } }),
  );
  await writeFile(path.join(dir, "dist", "index.html"), `<!doctype html><meta charset="utf-8"><p>${id}</p>`);
  return dir;
}

function listed(id: string, version: string): Record<string, unknown> {
  return {
    id,
    name: id,
    description: null,
    version,
    minTavora: null,
    games: [],
    workspaces: true,
    permissions: { network: [], connectors: [] },
    owner: "a".repeat(32),
    publisher: null,
    zip: { sha256: "b".repeat(64), size: 10 },
    publishedAt: "2026-10-18T10:00:00.000Z",
    notes: [],
  };
}

test("a release copy says when the catalog is behind it, and the sidebar counts them", async () => {
  const folders = [await copy("wellbrained.fresh", "0.2.0"), await copy("wellbrained.mine", "0.1.0"), await copy("wellbrained.same", "0.1.0-alpha.13"), await copy("local.work", "0.1.0")];
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ modules: request.url?.startsWith("/v1/catalog") ? [listed("wellbrained.fresh", "0.1.0"), listed("wellbrained.same", "0.1.0-alpha.13")] : [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const userData = await newUserData();
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), developmentFolders: folders }));
  const { app, page } = await launch(userData, [], { env: { TAVORA_API_URL: url } });
  try {
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("settings-nav-development-count")).toHaveText("2");
    await page.getByTestId("settings-nav-development").click();
    await expect(page.getByTestId("module-pending-wellbrained.fresh")).toHaveText("New version");
    await expect(page.getByTestId("module-pending-wellbrained.mine")).toHaveText("Not published yet");
    await expect(page.getByTestId("module-pending-wellbrained.same")).toHaveCount(0);
    await expect(page.getByTestId("module-pending-local.work")).toHaveCount(0);
  } finally {
    await app.close();
    server.close();
  }
});

test("nothing is said while the catalog can't be reached", async () => {
  const folders = [await copy("wellbrained.fresh", "0.2.0")];
  const userData = await newUserData();
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), developmentFolders: folders }));
  const { app, page } = await launch(userData, [], { env: { TAVORA_API_URL: "http://127.0.0.1:1" } });
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-development").click();
    await expect(page.getByTestId("dev-module-wellbrained.fresh")).toBeVisible();
    await expect(page.locator('[data-testid^="module-pending-"]')).toHaveCount(0);
    await expect(page.getByTestId("settings-nav-development-count")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
