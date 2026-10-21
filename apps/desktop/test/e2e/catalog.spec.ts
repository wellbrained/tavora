// The Browse tab of the module library: modules from Tavora's catalog, fetched and checked by the
// main process from a fake catalog server. A listed zip installs only when it is the zip the listing
// names and is signed by the listed publisher key (catalog threat model, C1); listing text is plain
// text (C10) and "by <name>" is only the service's developer name (C13). A report names only the
// module, its key and its zip (C12).
import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { fingerprint, packModule } from "@tavora/pack";
import { expectModuleText, launch, newUserData, openGame, panels, seedLibrary } from "./harness";

interface Listed {
  entry: Record<string, unknown>;
  /** What the server sends for the entry's zip hash. */
  body: Buffer;
  /** What GET /v1/catalog/modules/<id> lists as its versions. */
  versions?: { version: string; publishedAt: string; notes: string[] }[];
  /** What the server sends for each picture hash (screenshots and the icon). */
  pictures?: Record<string, Buffer>;
  /** The readme GET /v1/catalog/modules/<id> sends. */
  readme?: string;
}

async function packed(id: string, name: string, key: KeyObject, version = "1.0.0", network: string[] = []): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-catalog-module-"));
  await mkdir(path.join(dir, "dist"));
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({ id, name, version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network } }),
  );
  await writeFile(path.join(dir, "dist", "index.html"), `<!doctype html><title>${name}</title><p data-testid="hello">${name}</p><p data-testid="version">${version}</p>`);
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
async function catalogServer(modules: Listed[]): Promise<{ url: string; server: Server; asked: string[]; reports: unknown[] }> {
  const asked: string[] = [];
  const reports: unknown[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://catalog");
    asked.push(url.pathname + url.search);
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === "/v1/catalog/report" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      reports.push({ headers: { cookie: request.headers.cookie ?? null, referer: request.headers.referer ?? null }, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      return send(202, { status: "received" });
    }
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
      return item ? send(200, { module: item.entry, versions: item.versions ?? [], readme: item.readme ?? null }) : send(404, { error: "not found" });
    }
    const shot = /^\/v1\/catalog\/pictures\/([0-9a-f]{64})\.(png|webp)$/.exec(url.pathname);
    const picture = shot && modules.map((item) => item.pictures?.[shot[1]!]).find((bytes) => bytes !== undefined);
    if (picture) {
      response.writeHead(200, { "content-type": `image/${shot[2]}` });
      return response.end(picture);
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
  return { url: `http://127.0.0.1:${address.port}`, server, asked, reports };
}

test("a player browses the catalog for a game, sees who publishes a module and installs it", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const owner = fingerprint(key);
  const tracker = await packed("wellbrained.tracker", "Tracker", key);
  const other = await packed("wellbrained.factory", "Factory", key);
  const { url, server, asked } = await catalogServer([
    { entry: listing("wellbrained.tracker", "Tracker", tracker, owner, { publisher: "wellbrained", description: "<b>Tracks</b> your runs" }), body: tracker },
    // Made for another game: listed, but it says which game and Install stays greyed out.
    { entry: listing("wellbrained.factory", "Factory", other, owner, { games: ["satisfactory"], workspaces: false }), body: other },
  ]);
  const { app, page, userData } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  try {
    await openGame(page, "poe2");
    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    const row = page.getByTestId("catalog-wellbrained.tracker");
    await expect(row).toBeVisible();
    await expect(page.getByTestId("catalog-fits-wellbrained.factory")).toHaveText("For Satisfactory");
    await expect(page.getByTestId("catalog-install-wellbrained.factory")).toBeDisabled();
    await expect(row.getByTestId("catalog-fits-wellbrained.tracker")).toHaveText("Works here");
    await expect(row.getByTestId("catalog-publisher")).toHaveText("by wellbrained");
    // Markup in a listing is text, never HTML.
    await expect(row.getByTestId("catalog-description")).toHaveText("<b>Tracks</b> your runs");
    await expect(row.locator("b")).toHaveCount(0);
    expect(asked).toContain("/v1/catalog");

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

test("a player opens a module's page with its readme, screenshots, access and homepage before installing", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const owner = fingerprint(key);
  const tracker = await packed("wellbrained.tracker", "Tracker", key);
  const picture = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const fake = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>");
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const { url, server, asked } = await catalogServer([
    {
      entry: listing("wellbrained.tracker", "Tracker", tracker, owner, {
        homepage: "https://example.com/tracker",
        permissions: { network: ["api.example.com"], connectors: [] },
        icon: { sha256: hash(picture), type: "png", size: picture.length },
        screenshots: [
          { sha256: hash(picture), type: "png", size: picture.length },
          // Listed as a PNG but is not one: left out.
          { sha256: hash(fake), type: "png", size: fake.length },
        ],
      }),
      body: tracker,
      pictures: { [hash(picture)]: picture, [hash(fake)]: fake },
      readme: "# Tracker\n\nTracks your **runs**. See [the wiki](https://example.com/wiki).\n\n- Splits by act\n- <img src=x onerror=alert(1)>",
      versions: [{ version: "1.0.0", publishedAt: "2026-10-18T10:00:00.000Z", notes: ["First version."] }],
    },
  ]);
  const { app, page, userData } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  try {
    await openGame(page, "poe2");
    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    await page.getByTestId("catalog-wellbrained.tracker").getByTestId("catalog-name").click();
    const info = page.getByTestId("catalog-info-wellbrained.tracker");
    await expect(info).toBeVisible();
    await expect(info.getByTestId("catalog-info-screenshot")).toHaveAttribute("src", `data:image/png;base64,${picture.toString("base64")}`);
    await expect(info.getByRole("button", { name: /Screenshot \d of/ })).toHaveCount(0);
    // The readme is plain text: no links, pictures or HTML.
    const readme = info.getByTestId("catalog-info-readme");
    await expect(readme.locator("h4")).toHaveText("Tracker");
    await expect(readme.locator("p")).toHaveText("Tracks your runs. See the wiki.");
    await expect(readme.locator("li")).toHaveText(["Splits by act", "<img src=x onerror=alert(1)>"]);
    await expect(readme.locator("a, img")).toHaveCount(0);
    await expect(info.getByTestId("catalog-info-notes")).toContainText("First version.");
    await expect(info.getByTestId("catalog-info-access")).toContainText("Loads data from api.example.com");
    await expect(info.getByTestId("catalog-icon")).toHaveAttribute("src", /^data:image\/png;base64,/);
    expect(asked).toContain(`/v1/catalog/pictures/${hash(picture)}.png`);
    expect(await readdir(path.join(userData, "modules")).catch(() => [])).toEqual([]);

    // The game has no Browser panel yet, so the player picks where the homepage opens.
    await expect(info.getByTestId("catalog-info-homepage")).toHaveText("example.com/tracker");
    await info.getByTestId("catalog-info-homepage").click();
    await expect(page.getByTestId("link-choice-url")).toHaveText("https://example.com/tracker");
    await page.getByTestId("link-choice-cancel").click();

    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    await page.getByTestId("catalog-wellbrained.tracker").getByTestId("catalog-name").click();
    await page.getByTestId("catalog-info-install").click();
    await expect(page.getByTestId("catalog-info-add")).toBeVisible();
    expect(await readdir(path.join(userData, "modules"))).toEqual(["wellbrained.tracker"]);
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
    expect(asked).toContain("/v1/catalog");
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

test("a catalog module updates without a restart, and an update adding a network host waits for consent while the old version keeps working", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const owner = fingerprint(key);
  const id = "wellbrained.tracker";
  const release = async (version: string, network: string[], notes: string[]): Promise<Listed> => {
    const zip = await packed(id, "Tracker", key, version, network);
    return { entry: listing(id, "Tracker", zip, owner, { version, permissions: { network, connectors: [] }, notes }), body: zip };
  };
  const modules = [await release("1.0.0", [], ["First version."])];
  const { url, server, asked } = await catalogServer(modules);
  const { app, page, userData } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  const settings = async () => {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-modules").click();
  };
  const checkForUpdates = async (toast: string) => {
    await settings();
    await page.getByTestId("check-module-updates").click();
    await expect(page.getByTestId("toast")).toHaveText(toast);
  };
  try {
    await openGame(page, "poe2");
    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    await page.getByTestId(`catalog-install-${id}`).click();
    await page.getByTestId(`catalog-add-${id}`).click();
    await expect(panels(page, id)).toHaveCount(1);
    await expectModuleText(app, id, "version", "1.0.0");

    // An update that asks for nothing new installs at once, and the open panel reloads with it.
    modules[0] = await release("1.1.0", [], ["Faster."]);
    await checkForUpdates("Updated: 1. Waiting for you: 0.");
    await page.getByTestId("settings-close").click();
    await expectModuleText(app, id, "version", "1.1.0");
    await expect(page.getByTestId("notice")).toHaveText("Tracker was updated to 1.1.0. What's new is in Settings > Modules.");
    // The update check asked for the whole catalog, never for the modules this player has (C11).
    expect(asked.filter((request) => request.startsWith("/v1/catalog?") || request === "/v1/catalog")).toContain("/v1/catalog");
    expect(asked.some((request) => request.startsWith("/v1/catalog?") && request.includes(id))).toBe(false);

    // An update that asks for a new network host waits; the panel keeps running 1.1.0 (C4).
    modules[0] = {
      ...(await release("1.2.0", ["api.example.com"], ["Reads your runs from api.example.com."])),
      versions: [
        { version: "1.2.0", publishedAt: "2026-10-18T12:00:00.000Z", notes: ["Reads your runs from api.example.com."] },
        { version: "1.1.0", publishedAt: "2026-10-18T11:00:00.000Z", notes: ["Faster."] },
      ],
    };
    await checkForUpdates("Updated: 0. Waiting for you: 1.");
    await expect(page.getByTestId(`module-update-${id}`)).toHaveText("Update to 1.2.0");
    await page.getByTestId("settings-close").click();
    const review = page.locator('[data-testid^="update-review-open-"]');
    await expect(review).toHaveCount(1);
    await expectModuleText(app, id, "version", "1.1.0");
    expect(JSON.parse(await readFile(path.join(userData, "modules", id, "tavora.module.json"), "utf8")).version).toBe("1.1.0");

    // Not now keeps it waiting and the old version running.
    await review.click();
    await expect(page.getByTestId("grant-hosts")).toHaveText("api.example.com");
    await expect(page.getByTestId(`module-notes-${id}-1.2.0`)).toContainText("Reads your runs from api.example.com.");
    await expect(page.getByTestId(`module-notes-${id}-1.1.0`)).toHaveCount(0);
    await page.getByTestId("grant-cancel").click();
    await expectModuleText(app, id, "version", "1.1.0");

    // Allowed: 1.2.0 installs, gets the host it asked for, and the panel reloads with it.
    await review.click();
    await page.getByTestId("grant-allow").click();
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
    await expectModuleText(app, id, "version", "1.2.0");
    await expect(review).toHaveCount(0);
    await expect(page.locator('[data-testid^="grant-review-open-"]')).toHaveCount(0);
    const grants = JSON.parse(await readFile(path.join(userData, "grants.json"), "utf8"));
    expect(grants.owners[owner][id].network).toEqual(["api.example.com"]);
  } finally {
    await app.close();
    server.close();
  }
});

test("a player reports a module from Browse and from Settings, and only its id, key and zip are sent", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const owner = fingerprint(key);
  const tracker = await packed("wellbrained.tracker", "Tracker", key);
  const sha256 = createHash("sha256").update(tracker).digest("hex");
  const { url, server, reports } = await catalogServer([{ entry: listing("wellbrained.tracker", "Tracker", tracker, owner, { publisher: "wellbrained" }), body: tracker }]);
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  const sent = { headers: { cookie: null, referer: null }, body: { id: "wellbrained.tracker", owner, sha256 } };
  try {
    await openGame(page, "poe2");
    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    // Nothing is sent until the player says yes.
    // Report is only on the module's page, not on its card.
    await expect(page.getByTestId("catalog-wellbrained.tracker").getByTestId("catalog-report-wellbrained.tracker")).toHaveCount(0);
    await page.getByTestId("catalog-wellbrained.tracker").getByTestId("catalog-name").click();
    await page.getByTestId("catalog-report-wellbrained.tracker").click();
    await expect(page.getByTestId("catalog-report-ask-wellbrained.tracker")).toContainText("nothing about you");
    expect(reports).toEqual([]);
    await page.getByTestId("catalog-report-send-wellbrained.tracker").click();
    await expect(page.getByTestId("catalog-reported-wellbrained.tracker")).toBeVisible();
    expect(reports).toEqual([sent]);
    await page.keyboard.press("Escape");

    // Installed from the catalog, it can be reported from Settings > Modules too.
    await page.getByTestId("catalog-install-wellbrained.tracker").click();
    await expect(page.getByTestId("catalog-add-wellbrained.tracker")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-modules").click();
    await page.getByTestId("report-module-wellbrained.tracker").click();
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("toast")).toHaveText("Reported Tracker. Thanks!");
    expect(reports).toEqual([sent, sent]);
  } finally {
    await app.close();
    server.close();
  }
});
