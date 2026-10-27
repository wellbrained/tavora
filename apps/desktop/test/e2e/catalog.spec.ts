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
  /** What GET /v1/catalog/modules/<id>/reviews sends. */
  reviews?: unknown;
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
    const reviews = /^\/v1\/catalog\/modules\/([^/]+)\/reviews$/.exec(url.pathname);
    if (reviews) {
      const item = modules.find((candidate) => candidate.entry.id === decodeURIComponent(reviews[1]!));
      return item ? send(200, item.reviews ?? { summary: null, reviews: [] }) : send(404, { error: "not found" });
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

test("a user browses the catalog for a game, sees who publishes a module and installs it", async () => {
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

    // The installed module is listed among the installed ones, from its publisher, tagged as from the catalog.
    await page.getByTestId("add-module").click();
    await expect(page.getByTestId("module-wellbrained.tracker")).toBeVisible();
    await expect(page.getByTestId("provenance-wellbrained.tracker")).toHaveText("Community");
  } finally {
    await app.close();
    server.close();
  }
});

test("a user opens a module's page with its readme, screenshots, access and homepage before installing", async () => {
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
        support: "https://example.com/tracker/feedback",
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
    // The readme is plain text: links are buttons that ask the host, never anchors; no pictures or HTML.
    // The title heading is left out, and the text before the first heading is the Overview.
    const readme = info.getByTestId("catalog-info-readme");
    await expect(readme.locator("h4")).toHaveCount(0);
    await expect(readme.locator("p")).toHaveText("Tracks your runs. See the wiki.");
    await expect(readme.locator("strong")).toHaveText("runs");
    await expect(readme.getByRole("button", { name: "the wiki" })).toHaveAttribute("title", "https://example.com/wiki");
    await expect(readme.locator("li")).toHaveText(["Splits by act", "<img src=x onerror=alert(1)>"]);
    await expect(readme.locator("a, img")).toHaveCount(0);
    await expect(info.getByTestId("catalog-info-notes")).toContainText("First version.");
    await expect(info.getByTestId("catalog-info-access")).toContainText("Loads data from api.example.com");
    await expect(info.getByTestId("catalog-icon")).toHaveAttribute("src", /^data:image\/png;base64,/);
    expect(asked).toContain(`/v1/catalog/pictures/${hash(picture)}.png`);
    expect(await readdir(path.join(userData, "modules")).catch(() => [])).toEqual([]);

    // The game has no Browser panel yet, so the user picks where the homepage opens.
    await expect(info.getByTestId("catalog-info-homepage")).toHaveText("example.com/tracker");
    await info.getByTestId("catalog-info-homepage").click();
    await expect(page.getByTestId("link-choice-url")).toHaveText("https://example.com/tracker");
    await page.getByTestId("link-choice-cancel").click();
    const reopen = async () => {
      await page.getByTestId("add-module").click();
      await page.getByTestId("module-tab-browse").click();
      await page.getByTestId("catalog-wellbrained.tracker").getByTestId("catalog-name").click();
    };
    await reopen();

    // One Send feedback button with its hint; the address comes from the listing again, so the page can't pick it.
    const support = info.getByTestId("catalog-info-support");
    await expect(support.getByRole("button")).toHaveText("Send feedback");
    await expect(support).toContainText("Bugs, ideas or questions go to the developer.");
    await support.getByRole("button").click();
    await expect(page.getByTestId("link-choice-url")).toHaveText("https://example.com/tracker/feedback");
    await page.getByTestId("link-choice-cancel").click();
    await reopen();
    await page.getByTestId("catalog-info-install").click();
    await expect(page.getByTestId("catalog-info-add")).toBeVisible();
    expect(await readdir(path.join(userData, "modules"))).toEqual(["wellbrained.tracker"]);
  } finally {
    await app.close();
    server.close();
  }
});

test("a user sees a module's rating on its card, how many gave each star, and its reviews on its page", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const owner = fingerprint(key);
  const tracker = await packed("wellbrained.tracker", "Tracker", key);
  const factory = await packed("wellbrained.factory", "Factory", key);
  const rating = { average: 4.7, count: 23, stars: [0, 1, 1, 3, 18] };
  const { url, server } = await catalogServer([
    {
      entry: listing("wellbrained.tracker", "Tracker", tracker, owner, { publisher: "wellbrained", description: "Tracks your runs.", rating }),
      body: tracker,
      reviews: {
        summary: rating,
        reviews: [
          {
            id: "AbCdEfGhIjKlMnOp",
            stars: 2,
            text: "Crashed on act 3.\n<b>Please fix</b>",
            version: "1.0.0",
            createdAt: "2026-10-20T10:00:00.000Z",
            updatedAt: "2026-10-20T10:00:00.000Z",
            author: { name: "Mara", initials: "MA", picture: null },
            reply: { text: "Fixed in 1.0.1, thanks!", updatedAt: "2026-10-21T10:00:00.000Z" },
          },
          { id: "bad", stars: 9, text: "dropped", version: "1.0.0", author: {} },
        ],
      },
    },
    // Two ratings are too few for an average.
    { entry: listing("wellbrained.factory", "Factory", factory, owner, { rating: { average: 5, count: 2, stars: [0, 0, 0, 0, 2] } }), body: factory },
  ]);
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  try {
    await openGame(page, "poe2");
    await page.getByTestId("add-module").click();
    await page.getByTestId("module-tab-browse").click();
    const card = page.getByTestId("catalog-wellbrained.tracker");
    await expect(card.getByTestId("catalog-rating")).toContainText("4.7");
    await expect(card.getByTestId("catalog-rating")).toContainText("(23)");
    await expect(card.locator("[data-slot=star-rating] [data-fill]")).toHaveCount(5);
    await expect(card.locator("[data-slot=star-rating] [data-fill=half]")).toHaveCount(1);
    await expect(page.getByTestId("catalog-wellbrained.factory").getByTestId("catalog-rating-new")).toHaveText("2 ratings");
    await expect(page.getByTestId("catalog-new-wellbrained.factory")).toHaveText("New");
    await expect(page.getByTestId("catalog-new-wellbrained.tracker")).toHaveCount(0);

    // Sorted by rating, the rated module comes first.
    await page.getByTestId("catalog-sort").click();
    await page.getByRole("option", { name: "Rating" }).click();
    await expect(page.getByTestId("catalog-name")).toHaveText(["Tracker", "Factory"]);
    await page.screenshot({ path: path.join(process.env.TAVORA_SHOTS ?? tmpdir(), "catalog-ratings.png") });

    await card.getByTestId("catalog-rating").click();
    const breakdown = page.getByTestId("catalog-rating-breakdown");
    await expect(breakdown).toContainText("4.7 out of 5 stars");
    await expect(breakdown.locator("li")).toHaveText([/5 stars\s*78%/, /4 stars\s*13%/, /3 stars\s*4%/, /2 stars\s*4%/, /1 star\s*0%/]);
    await page.screenshot({ path: path.join(process.env.TAVORA_SHOTS ?? tmpdir(), "catalog-rating-breakdown.png") });
    await page.getByTestId("catalog-rating-reviews").click();

    const info = page.getByTestId("catalog-info-wellbrained.tracker");
    const reviews = info.getByTestId("catalog-reviews");
    await expect(reviews.getByTestId("catalog-reviews-summary")).toContainText("23 ratings");
    // Signed out: no stars to pick, a way to sign in instead.
    await expect(reviews.getByTestId("catalog-reviews-sign-in")).toBeVisible();
    await expect(reviews.getByTestId("catalog-reviews-stars")).toHaveCount(0);
    // Only the well-formed review shows, as plain text, with the publisher's reply.
    const review = reviews.getByTestId("catalog-review-AbCdEfGhIjKlMnOp");
    await expect(reviews.locator("[data-testid^=catalog-review-]").filter({ has: page.getByTestId("catalog-review-reply") })).toHaveCount(1);
    await expect(review).toContainText("Mara");
    await expect(review).toContainText("<b>Please fix</b>");
    await expect(review.locator("b")).toHaveCount(0);
    await expect(review.getByTestId("catalog-review-reply")).toContainText("Reply from wellbrained");
    await reviews.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(process.env.TAVORA_SHOTS ?? tmpdir(), "catalog-reviews.png") });
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
    await expect(page.getByTestId("catalog-error-wellbrained.swapped")).toHaveText("The download doesn't match what was published, so nothing was installed.");
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

test("catalog module updates wait for the user, install from the Updates view without a restart, and one adding a network host waits for consent while the old version keeps working", async () => {
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

    // Modules do not update by themselves unless the user turns that on: an update that asks for
    // nothing new is only found, and the old version keeps running.
    modules[0] = await release("1.1.0", [], ["Faster."]);
    await checkForUpdates("Found 1 update. It is ready when you are.");
    await page.getByTestId("settings-close").click();
    await expectModuleText(app, id, "version", "1.0.0");
    await expect(page.getByTestId("module-updates-button")).toHaveText("1 update");

    // The module's page says the version installed, and the newest one beside it.
    await page.getByTestId("add-module").click();
    await page.getByTestId(`module-name-${id}`).click();
    const info = page.getByTestId(`catalog-info-${id}`);
    await expect(info.getByTestId("catalog-info-version")).toHaveText("1.0.0");
    await expect(info.getByTestId("catalog-info-newest")).toHaveText("1.1.0");
    await page.keyboard.press("Escape");
    await expect(info).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);

    // The header button opens the library on Updates: versions, what is new, and Update.
    await page.getByTestId("module-updates-button").click();
    await expect(page.getByTestId("module-view-title")).toHaveText("Updates");
    await expect(page.getByTestId(`update-versions-${id}`)).toHaveText("1.0.0 → 1.1.0");
    await expect(page.getByTestId(`update-notes-${id}`)).toContainText("Faster.");
    await page.getByTestId(`update-module-${id}`).click();
    await expect(page.getByTestId("module-updates-empty")).toBeVisible();
    await expectModuleText(app, id, "version", "1.1.0");
    await expect(page.getByTestId("module-updates-button")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // The update check asked for the whole catalog, never for the modules this user has (C11).
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
    await checkForUpdates("Found 1 update. It is ready when you are.");
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

    // An update that asks for more also goes through the consent dialog from the Updates view,
    // which it returns to; not now leaves it waiting.
    modules[0] = await release("1.3.0", ["api.example.com", "api.other.example.com"], ["More sites."]);
    await checkForUpdates("Found 1 update. It is ready when you are.");
    await page.getByTestId("settings-close").click();
    await page.getByTestId("module-updates-button").click();
    await expect(page.getByTestId(`update-${id}`)).toContainText("Asks for new access first.");
    await page.getByTestId("update-all-modules").click();
    await expect(page.getByTestId("grant-hosts")).toHaveText("api.other.example.com");
    await page.getByTestId("grant-cancel").click();
    await expect(page.getByTestId("module-view-title")).toHaveText("Updates");
    await expectModuleText(app, id, "version", "1.2.0");
    await page.getByTestId(`update-module-${id}`).click();
    await page.getByTestId("grant-allow").click();
    await expect(page.getByTestId("module-updates-empty")).toBeVisible();
    await expectModuleText(app, id, "version", "1.3.0");
    await page.keyboard.press("Escape");

    // With "Update modules automatically" on, an update that asks for nothing new installs by itself.
    modules[0] = await release("1.4.0", ["api.example.com", "api.other.example.com"], ["Quicker."]);
    await settings();
    await page.getByTestId("auto-update-modules").click();
    await expectModuleText(app, id, "version", "1.4.0");
    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("notice")).toHaveText("Tracker was updated to 1.4.0. What's new is in Settings > Modules.");
  } finally {
    await app.close();
    server.close();
  }
});

test("a user reports a module from Browse and from Settings, and only its id, key and zip are sent", async () => {
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
    // Nothing is sent until the user says yes.
    // Report is only on the module's page, not on its card.
    await expect(page.getByTestId("catalog-wellbrained.tracker").getByTestId("catalog-report-wellbrained.tracker")).toHaveCount(0);
    await page.getByTestId("catalog-wellbrained.tracker").getByTestId("catalog-name").click();
    // No support link in this listing, so no Send feedback button.
    await expect(page.getByTestId("catalog-info-support")).toHaveCount(0);
    await expect(page.getByTestId("catalog-report-wellbrained.tracker")).toHaveText("Report to Tavora");
    await expect(page.getByTestId("catalog-info-report")).toContainText("Harmful, or breaks the rules.");
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
    await page.getByTestId("module-more-wellbrained.tracker").click();
    await expect(page.getByTestId("report-module-wellbrained.tracker")).toHaveText("Report to Tavora");
    await page.getByTestId("report-module-wellbrained.tracker").click();
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("toast")).toHaveText("Reported Tracker. Thanks!");
    expect(reports).toEqual([sent, sent]);
  } finally {
    await app.close();
    server.close();
  }
});
