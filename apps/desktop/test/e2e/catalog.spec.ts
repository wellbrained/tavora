// The Browse tab of the module library: modules from Tavora's catalog, fetched and checked by the
// main process from a fake catalog server. A listed zip installs only when it is the zip the listing
// names and is signed by the listed publisher key (catalog threat model, C1); listing text is plain
// text (C10) and "by <name>" is only the service's developer name (C13).
import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { fingerprint, packModule } from "@tavora/pack";
import { launch, newUserData, openGame, panels, seedLibrary } from "./harness";

interface Listed {
  entry: Record<string, unknown>;
  /** What the server sends for the entry's zip hash. */
  body: Buffer;
}

async function packed(id: string, name: string, key: KeyObject): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-catalog-module-"));
  await mkdir(path.join(dir, "dist"));
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({ id, name, version: "1.0.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } }),
  );
  await writeFile(path.join(dir, "dist", "index.html"), `<!doctype html><title>${name}</title><p data-testid="hello">${name}</p>`);
  return (await packModule(dir, key)).zip;
}

function listing(id: string, name: string, zip: Buffer, owner: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name,
    description: null,
    version: "1.0.0",
    minTavora: null,
    games: [],
    workspaces: true,
    permissions: { network: [], connectors: [] },
    owner,
    publisher: null,
    zip: { sha256: createHash("sha256").update(zip).digest("hex"), size: zip.length },
    publishedAt: "2026-10-18T10:00:00.000Z",
    notes: [],
    ...fields,
  };
}

/** A catalog server that answers like api.mytavora.app/v1/catalog, and records what was asked. */
async function catalogServer(modules: Listed[]): Promise<{ url: string; server: Server; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://catalog");
    asked.push(url.pathname + url.search);
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === "/v1/catalog") {
      const game = url.searchParams.get("game");
      const workspace = url.searchParams.get("workspace") === "1";
      const fits = (entry: Record<string, unknown>) => {
        const games = entry.games as string[];
        return workspace ? games.length === 0 && entry.workspaces !== false : !game || games.length === 0 || games.includes(game);
      };
      return send(200, { modules: modules.map((item) => item.entry).filter(fits) });
    }
    const detail = /^\/v1\/catalog\/modules\/([^/]+)$/.exec(url.pathname);
    if (detail) {
      const item = modules.find((candidate) => candidate.entry.id === decodeURIComponent(detail[1]!));
      return item ? send(200, { module: item.entry, versions: [] }) : send(404, { error: "not found" });
    }
    const zip = /^\/v1\/catalog\/zips\/([0-9a-f]{64})\.zip$/.exec(url.pathname);
    if (zip) {
      const item = modules.find((candidate) => (candidate.entry.zip as { sha256: string }).sha256 === zip[1]);
      if (!item) return send(404, { error: "not found" });
      response.writeHead(200, { "content-type": "application/zip" });
      return response.end(item.body);
    }
    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, server, asked };
}

test("a player browses the catalog for a game, sees who publishes a module and installs it", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const owner = fingerprint(key);
  const tracker = await packed("wellbrained.tracker", "Tracker", key);
  const other = await packed("wellbrained.factory", "Factory", key);
  const { url, server, asked } = await catalogServer([
    { entry: listing("wellbrained.tracker", "Tracker", tracker, owner, { publisher: "wellbrained", description: "<b>Tracks</b> your runs" }), body: tracker },
    // Made for another game: not listed here even when the service sends it.
    { entry: listing("wellbrained.factory", "Factory", other, owner, { games: ["satisfactory"], workspaces: false }), body: other },
  ]);
  const { app, page, userData } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  try {
    await openGame(page, "poe2");
    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    const row = page.getByTestId("catalog-wellbrained.tracker");
    await expect(row).toBeVisible();
    await expect(page.getByTestId("catalog-wellbrained.factory")).toHaveCount(0);
    await expect(row.getByTestId("catalog-publisher")).toHaveText("by wellbrained");
    // Markup in a listing is text, never HTML.
    await expect(row.getByTestId("catalog-description")).toHaveText("<b>Tracks</b> your runs");
    await expect(row.locator("b")).toHaveCount(0);
    expect(asked).toContain("/v1/catalog?game=poe2");

    await page.getByTestId("catalog-install-wellbrained.tracker").click();
    await expect(page.getByTestId("catalog-add-wellbrained.tracker")).toBeVisible();
    expect(await readdir(path.join(userData, "modules"))).toEqual(["wellbrained.tracker"]);
    await page.getByTestId("catalog-add-wellbrained.tracker").click();
    await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);
    await expect(panels(page, "wellbrained.tracker")).toHaveCount(1);

    // The installed module is listed among the installed ones, from its publisher.
    await page.getByTestId("add-module").click();
    await expect(page.getByTestId("module-wellbrained.tracker")).toBeVisible();
  } finally {
    await app.close();
    server.close();
  }
});

test("a zip that is not the listed one, or not from the listed key, writes nothing", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const stranger = generateKeyPairSync("ed25519").privateKey;
  const good = await packed("wellbrained.swapped", "Swapped", key);
  const foreign = await packed("wellbrained.foreign", "Foreign", stranger);
  // The listing names the good zip's hash, but the server sends other bytes for it.
  const tampered = Buffer.from(good);
  tampered[tampered.length - 30] = (tampered[tampered.length - 30]! + 1) % 256;
  const { url, server } = await catalogServer([
    { entry: listing("wellbrained.swapped", "Swapped", good, fingerprint(key)), body: tampered },
    // Its hash matches, but another key signed it than the listing names.
    { entry: listing("wellbrained.foreign", "Foreign", foreign, fingerprint(key), { publisher: "wellbrained" }), body: foreign },
  ]);
  const { app, page, userData } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  try {
    await openGame(page, "poe2");
    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    await page.getByTestId("catalog-install-wellbrained.swapped").click();
    await expect(page.getByTestId("catalog-error-wellbrained.swapped")).toHaveText("The download doesn't match what the catalog listed, so nothing was installed.");
    await page.getByTestId("catalog-install-wellbrained.foreign").click();
    await expect(page.getByTestId("catalog-error-wellbrained.foreign")).toContainText("not signed by the publisher key that was listed");
    expect(await readdir(path.join(userData, "modules")).catch(() => [])).toEqual([]);
    await expect(page.getByTestId("catalog-add-wellbrained.swapped")).toHaveCount(0);
  } finally {
    await app.close();
    server.close();
  }
});

test("the catalog asks for a personal workspace's modules, and stays offline with online features off", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const notes = await packed("wellbrained.notes", "Pocket notes", key);
  const { url, server, asked } = await catalogServer([{ entry: listing("wellbrained.notes", "Pocket notes", notes, fingerprint(key)), body: notes }]);
  const userData = await newUserData();
  const { app, page } = await launch(userData, [], { env: { TAVORA_API_URL: url } });
  try {
    await page.getByTestId("rail-add-game").click();
    await page.getByTestId("game-search").fill("Personal");
    await page.getByTestId("open-add-workspace").click();
    await page.getByTestId("create-workspace").click();
    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    await expect(page.getByTestId("catalog-wellbrained.notes")).toBeVisible();
    expect(asked).toContain("/v1/catalog?workspace=1");
  } finally {
    await app.close();
  }

  const before = asked.length;
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), onlineSearch: false }));
  const offline = await launch(userData, [], { env: { TAVORA_API_URL: url } });
  try {
    await openGame(offline.page, "poe2");
    await offline.page.getByTestId("add-module").click();
    await offline.page.getByTestId("module-tab-browse").click();
    await expect(offline.page.getByTestId("catalog-off")).toBeVisible();
    expect(asked.slice(before).filter((request) => request.startsWith("/v1/catalog"))).toEqual([]);
  } finally {
    await offline.app.close();
    server.close();
  }
});
