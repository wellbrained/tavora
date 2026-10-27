import { createHash, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { CatalogError, CatalogStore, compareModuleVersions } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { encodePng } from "./png.ts";
import { createRateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const publisher = generateKeyPairSync("ed25519").privateKey;
const other = generateKeyPairSync("ed25519").privateKey;

interface Options {
  id?: string;
  version?: string;
  games?: string[];
  /** The old name of personalWorkspaces. */
  workspaces?: boolean;
  personalWorkspaces?: boolean;
  key?: KeyObject | null;
  changelog?: unknown;
  homepage?: string;
  support?: string;
  translations?: Record<string, unknown>;
  readme?: Buffer;
  icon?: ZipFile;
  /** Screenshot files, named in the manifest in this order and put in the zip. */
  screenshots?: ZipFile[];
  extra?: ZipFile[];
}

/** A module zip as tavora-pack makes it: manifest, page, optional changelog, and the signature. */
function moduleZip({ id = "wellbrained.timer", version = "1.0.0", games = [], workspaces, personalWorkspaces, key = publisher, changelog, homepage, support, translations, readme, icon, screenshots = [], extra = [] }: Options = {}): Buffer {
  const manifest = {
    id,
    name: "Timer",
    description: "<b>Counts</b> down.",
    version,
    apiVersion: "1",
    entry: "dist/index.html",
    games,
    ...(workspaces === undefined ? {} : { workspaces }),
    ...(personalWorkspaces === undefined ? {} : { minTavora: "0.21.43", personalWorkspaces }),
    ...(changelog === undefined ? {} : { changelog: "changelog.json" }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(support === undefined ? {} : { support }),
    ...(translations === undefined ? {} : { minTavora: "0.21.0", translations }),
    ...(readme === undefined ? {} : { readme: "README.md" }),
    ...(icon === undefined ? {} : { icon: icon.name }),
    ...(screenshots.length ? { screenshots: screenshots.map((shot) => shot.name) } : {}),
    viewport: { minWidth: 200, minHeight: 150 },
    permissions: { network: ["api.example.com"] },
  };
  const files: ZipFile[] = [
    { name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: "dist/index.html", data: Buffer.from("<!doctype html><p>timer</p>") },
    ...(changelog === undefined ? [] : [{ name: "changelog.json", data: Buffer.from(JSON.stringify(changelog)) }]),
    ...screenshots,
    ...(readme === undefined ? [] : [{ name: "README.md", data: readme }]),
    ...(icon === undefined ? [] : [icon]),
    ...extra,
  ];
  return writeZip(key ? [...files, signFiles(files, key)] : files);
}

const png = (size = 8) => Buffer.from(encodePng(size, size, new Uint8Array(size * size * 4).fill(200)));
/** The smallest well-formed WebP header: RIFF, its size, WEBP and one VP8L chunk. */
const webp = () => {
  const chunk = Buffer.from([0x2f, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from("WEBPVP8L"), Buffer.from([chunk.length, 0, 0, 0]), chunk, Buffer.from([0])]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, body]);
};

/** A PNG whose header says 4097 px wide: small as a file, too big as a picture. */
const wide = () => {
  const bytes = png();
  bytes.writeUInt32BE(4097, 16);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
};

const store = () => new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-")));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("adding to the catalog", () => {
  it("hands the admin panel every version's notes, empty when the changelog has none", () => {
    const catalog = store();
    catalog.add(moduleZip({ changelog: [{ version: "1.0.0", notes: ["First version."] }] }), new Date("2026-10-18T10:00:00Z"));
    catalog.add(moduleZip({ version: "1.1.0" }), new Date("2026-10-19T10:00:00Z"));
    expect(catalog.adminModules()[0]?.versions.map((version) => [version.version, version.notes])).toEqual([
      ["1.1.0", []],
      ["1.0.0", ["First version."]],
    ]);
  });

  it("tells the admin panel which versions are listed and which still wait for review", () => {
    const catalog = store();
    const waiting = { reasons: [{ check: "virus", text: "The virus scan found something." }], language: "en", token: null };
    catalog.add(moduleZip(), new Date("2026-10-18T10:00:00Z"), null, undefined, undefined, waiting);
    expect(catalog.adminModules()[0]?.versions.map((version) => [version.version, version.status])).toEqual([["1.0.0", "waiting"]]);
    catalog.add(moduleZip({ version: "1.1.0" }), new Date("2026-10-19T10:00:00Z"));
    expect(catalog.adminModules()[0]?.versions.map((version) => [version.version, version.status])).toEqual([
      ["1.1.0", "listed"],
      ["1.0.0", "waiting"],
    ]);
  });

  it("stores a signed zip under its hash with this version's notes", () => {
    const catalog = store();
    const zip = moduleZip({ changelog: [{ version: "1.0.0", notes: ["First version."] }] });
    const added = catalog.add(zip, new Date("2026-10-18T10:00:00Z"));
    expect(added.sha256).toBe(sha(zip));
    expect(catalog.zip(added.sha256)).toEqual(zip);
    expect(catalog.index()).toEqual([
      {
        id: "wellbrained.timer",
        name: "Timer",
        description: "<b>Counts</b> down.",
        version: "1.0.0",
        minTavora: null,
        games: [],
        personalWorkspaces: true,
        workspaces: true,
        permissions: { network: ["api.example.com"], connectors: [] },
        owner: added.owner,
        zip: { sha256: added.sha256, size: zip.length },
        publishedAt: "2026-10-18T10:00:00.000Z",
        notes: ["First version."],
        homepage: null,
        support: null,
        translations: {},
        screenshots: [],
        icon: null,
      },
    ]);
  });

  it("lists the translated name and description, by language", () => {
    const catalog = store();
    catalog.add(moduleZip({ translations: { de: { name: "Zeitmesser", description: "Zählt runter." }, fr: { name: "Minuteur" }, nl: { description: "Telt af." } } }));
    expect(catalog.index()[0]?.translations).toEqual({ de: { name: "Zeitmesser", description: "Zählt runter." }, fr: { name: "Minuteur" }, nl: { description: "Telt af." } });
  });

  it("lists the support link, an https address or an email address, and refuses any other", () => {
    const catalog = store();
    catalog.add(moduleZip({ support: "feedback@example.com" }));
    expect(catalog.index()[0]?.support).toBe("feedback@example.com");
    catalog.add(moduleZip({ version: "1.0.1", support: "https://example.com/feedback" }));
    expect(catalog.index()[0]?.support).toBe("https://example.com/feedback");
    expect(() => catalog.add(moduleZip({ version: "1.0.2", support: "http://example.com" }))).toThrow(CatalogError);
    expect(() => catalog.add(moduleZip({ version: "1.0.2", support: "javascript:alert(1)" }))).toThrow(CatalogError);
  });

  it("lists the homepage and checked screenshots, and serves only the newest version's", () => {
    const catalog = store();
    const first = png();
    const second = webp();
    catalog.add(moduleZip({ homepage: "https://example.com/timer", screenshots: [{ name: "shots/one.png", data: first }, { name: "shots/two.webp", data: second }] }));
    const [entry] = catalog.index();
    expect(entry?.homepage).toBe("https://example.com/timer");
    expect(entry?.screenshots).toEqual([
      { sha256: sha(first), type: "png", size: first.length },
      { sha256: sha(second), type: "webp", size: second.length },
    ]);
    expect(catalog.picture(sha(first), "png")).toEqual(first);
    expect(catalog.picture(sha(second), "webp")).toEqual(second);
    expect(catalog.picture(sha(first), "webp")).toBeNull();

    catalog.add(moduleZip({ version: "1.1.0", screenshots: [{ name: "shots/one.png", data: png(9) }] }));
    expect(catalog.picture(sha(first), "png")).toBeNull();
    expect(catalog.picture(sha(png(9)), "png")).not.toBeNull();
    catalog.setListed("wellbrained.timer", false);
    expect(catalog.picture(sha(png(9)), "png")).toBeNull();
  });

  it("keeps the readme as text for the module's page, and lists the icon only when it is a real picture", () => {
    const catalog = store();
    const icon = png(64);
    catalog.add(moduleZip({ readme: Buffer.from("\ufeff# Timer\r\n\r\nCounts **down**."), icon: { name: "icon.png", data: icon } }));
    expect(catalog.module("wellbrained.timer")?.readme).toBe("# Timer\n\nCounts **down**.");
    expect(catalog.index()[0]?.icon).toEqual({ sha256: sha(icon), type: "png", size: icon.length });
    expect(catalog.picture(sha(icon), "png")).toEqual(icon);

    catalog.add(moduleZip({ version: "1.1.0", icon: { name: "icon.png", data: Buffer.from("<svg/>") } }));
    expect(catalog.index()[0]?.icon).toBeNull();
    expect(catalog.module("wellbrained.timer")?.readme).toBeNull();
    expect(catalog.picture(sha(icon), "png")).toBeNull();

    expect(() => catalog.add(moduleZip({ version: "1.2.0", readme: Buffer.from([0xff, 0xfe, 0x00]) }))).toThrow(/readme/);
    expect(() => catalog.add(moduleZip({ version: "1.2.0", readme: Buffer.alloc(21 * 1024, "a") }))).toThrow(/readme/);
  });

  it("refuses screenshots that are not real pictures, or too big", () => {
    const catalog = store();
    const refused = (data: Buffer, name = "shot.png") => expect(() => catalog.add(moduleZip({ screenshots: [{ name, data }] }))).toThrow(/screenshot/);
    refused(Buffer.from("<svg onload=alert(1)>"));
    refused(Buffer.from("<html>not a picture</html>"), "shot.webp");
    refused(webp(), "shot.png");
    refused(wide());
    refused(Buffer.concat([png(), Buffer.from("extra")]));
    const big = Buffer.concat([webp(), randomBytes(1024 * 1024)]);
    big.writeUInt32LE(big.length - 8, 4);
    refused(big, "shot.webp");
    expect(() => catalog.add(moduleZip({ homepage: "javascript:alert(1)" }))).toThrow(CatalogError);
    expect(catalog.index()).toEqual([]);
  });

  it("refuses unsigned zips, Tavora's own ids, broken manifests and zips that do not match their signature", () => {
    const catalog = store();
    expect(() => catalog.add(moduleZip({ key: null }))).toThrow(/not signed/);
    expect(() => catalog.add(moduleZip({ id: "tavora.timer" }))).toThrow(/reserved/);
    expect(() => catalog.add(writeZip([{ name: "tavora.module.json", data: Buffer.from("{") }]))).toThrow(/not valid JSON/);
    expect(() => catalog.add(Buffer.from("not a zip"))).toThrow(CatalogError);
    const signed = moduleZip();
    const tampered = writeZip([{ name: "tavora.module.json", data: Buffer.from(JSON.stringify({ id: "wellbrained.timer" })) }]);
    expect(() => catalog.add(tampered)).toThrow(/manifest is invalid/);
    expect(() => catalog.add(moduleZip({ changelog: { not: "an array" } }))).toThrow(/changelog is invalid/);
    expect(catalog.modules()).toEqual([]);
    expect(catalog.add(signed).manifest.id).toBe("wellbrained.timer");
  });

  it("takes later versions only from the same key, and only newer ones", () => {
    const catalog = store();
    catalog.add(moduleZip({ version: "1.0.0" }));
    expect(() => catalog.add(moduleZip({ version: "1.1.0", key: other }))).toThrow(/another publisher key/);
    expect(() => catalog.add(moduleZip({ version: "0.9.0" }))).toThrow(/must be newer/);
    expect(() => catalog.add(moduleZip({ version: "1.0.0", extra: [{ name: "x.txt", data: Buffer.from("x") }] }))).toThrow(/must be newer/);
    catalog.add(moduleZip({ version: "1.1.0", changelog: [{ version: "1.1.0", notes: ["Faster."] }] }));
    expect(catalog.index().map((entry) => entry.version)).toEqual(["1.1.0"]);
    expect(catalog.module("wellbrained.timer")?.versions.map(({ version, notes }) => ({ version, notes }))).toEqual([
      { version: "1.1.0", notes: ["Faster."] },
      { version: "1.0.0", notes: [] },
    ]);
  });

  it("filters by game and personal workspace, and hides delisted modules and their zips", () => {
    const catalog = store();
    const any = catalog.add(moduleZip({ id: "wellbrained.notes" }));
    catalog.add(moduleZip({ id: "wellbrained.map", games: ["elden-ring"] }));
    catalog.add(moduleZip({ id: "wellbrained.overlay", workspaces: false }));
    catalog.add(moduleZip({ id: "wellbrained.radar", personalWorkspaces: false }));
    const ids = (filter: Parameters<CatalogStore["index"]>[0]) => catalog.index(filter).map((entry) => entry.id);
    expect(ids({})).toEqual(["wellbrained.map", "wellbrained.notes", "wellbrained.overlay", "wellbrained.radar"]);
    expect(ids({ game: "elden-ring" })).toEqual(["wellbrained.map", "wellbrained.notes", "wellbrained.overlay", "wellbrained.radar"]);
    expect(ids({ game: "satisfactory" })).toEqual(["wellbrained.notes", "wellbrained.overlay", "wellbrained.radar"]);
    expect(ids({ personal: true })).toEqual(["wellbrained.notes"]);
    // Tavora 0.21.42 and older read the old name.
    expect(catalog.index({}).map((entry) => [entry.id, entry.personalWorkspaces, entry.workspaces])).toContainEqual(["wellbrained.radar", false, false]);

    expect(catalog.setListed("wellbrained.notes", false)).toBe(true);
    expect(ids({ personal: true })).toEqual([]);
    expect(catalog.module("wellbrained.notes")).toBeNull();
    expect(catalog.zip(any.sha256)).toBeNull();
    expect(catalog.modules().find((row) => row.id === "wellbrained.notes")?.listed).toBe(false);
    catalog.setListed("wellbrained.notes", true);
    expect(catalog.zip(any.sha256)).not.toBeNull();
    expect(catalog.setListed("wellbrained.nothing", false)).toBe(false);
  });

  it("never hands out a stored zip whose bytes no longer match its name", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-catalog-"));
    const catalog = new CatalogStore(dir);
    const added = catalog.add(moduleZip());
    writeFileSync(path.join(dir, "zips", `${added.sha256}.zip`), "changed");
    expect(catalog.zip(added.sha256)).toBeNull();
  });
});

describe("version order", () => {
  it("matches semver precedence", () => {
    const ordered = ["0.9.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.10.0"];
    for (let i = 1; i < ordered.length; i++) expect(compareModuleVersions(ordered[i - 1]!, ordered[i]!)).toBeLessThan(0);
    expect(compareModuleVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("catalog routes", () => {
  const setup = () => {
    const catalog = store();
    const app = createApp({ db, catalog, rateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }) });
    return { catalog, get: (url: string) => app.request(`http://tavora.test${url}`) };
  };

  it("serves the index, a module's versions and its zip, with no sign-in", async () => {
    const { catalog, get } = setup();
    const zip = moduleZip({ games: ["elden-ring"] });
    const added = catalog.add(zip);

    const index = await get("/v1/catalog?game=elden-ring");
    expect(index.status).toBe(200);
    expect(index.headers.get("cache-control")).toBe("public, max-age=300");
    const body = (await index.json()) as { modules: { id: string; publisher: string | null }[] };
    expect(body.modules.map((entry) => [entry.id, entry.publisher])).toEqual([["wellbrained.timer", null]]);
    expect(((await (await get("/v1/catalog?game=satisfactory")).json()) as { modules: unknown[] }).modules).toEqual([]);
    expect(((await (await get("/v1/catalog")).json()) as { modules: unknown[] }).modules).toHaveLength(1);

    const module = (await (await get("/v1/catalog/modules/wellbrained.timer")).json()) as { module: { version: string }; versions: { version: string }[] };
    expect(module.module.version).toBe("1.0.0");
    expect(module.versions.map((version) => version.version)).toEqual(["1.0.0"]);
    expect((await get("/v1/catalog/modules/wellbrained.nothing")).status).toBe(404);

    const download = await get(`/v1/catalog/zips/${added.sha256}.zip`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    expect(download.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(zip);
    expect((await get(`/v1/catalog/zips/${"0".repeat(64)}.zip`)).status).toBe(404);
    expect((await get("/v1/catalog/zips/../catalog.sqlite")).status).toBe(404);
  });

  it("serves a listed screenshot as a plain picture", async () => {
    const { catalog, get } = setup();
    const shot = png();
    catalog.add(moduleZip({ screenshots: [{ name: "shot.png", data: shot }] }));
    const answer = await get(`/v1/catalog/pictures/${sha(shot)}.png`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("image/png");
    expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
    expect(answer.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await answer.arrayBuffer())).toEqual(shot);
    expect((await get(`/v1/catalog/pictures/${sha(shot)}.webp`)).status).toBe(404);
    expect((await get(`/v1/catalog/pictures/${sha(shot)}.svg`)).status).toBe(404);
    expect((await get(`/v1/catalog/pictures/${"0".repeat(64)}.png`)).status).toBe(404);
  });

  it("names the publisher from the account the key is linked to, never from the listing", async () => {
    const catalog = store();
    const added = catalog.add(moduleZip());
    const accounts = new AccountStore(":memory:");
    const now = Date.parse("2026-10-18T10:00:00Z");
    const account = accounts.createAccount({ email: "dev@example.com" }, now);
    accounts.setDeveloperName(account.id, "Wellbrained", now);
    accounts.linkKey(account.id, added.owner, "unused", now);
    const app = createApp({ db, catalog, rateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }), accounts: { store: accounts, mailer: createTestInbox() } });
    const body = (await (await app.request("http://tavora.test/v1/catalog")).json()) as { modules: { publisher: string | null }[] };
    expect(body.modules.map((entry) => entry.publisher)).toEqual(["Wellbrained"]);
  });

  it("serves the signed lists unchanged, and nothing before they exist", async () => {
    const { catalog, get } = setup();
    expect((await get("/v1/catalog/lists/revocations.json")).status).toBe(404);
    const signed = Buffer.from('{"format":"tavora-revocations-1","sequence":3,  "signature":"..."}\n');
    catalog.setList("revocations", signed);
    const answer = await get("/v1/catalog/lists/revocations.json");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("application/json");
    expect(answer.headers.get("cache-control")).toBe("public, max-age=300");
    expect(Buffer.from(await answer.arrayBuffer())).toEqual(signed);
    expect((await get("/v1/catalog/lists/blocks.json")).status).toBe(404);
    expect((await get("/v1/catalog/lists/other.json")).status).toBe(404);
    expect(() => catalog.setList("blocks", Buffer.from("not json"))).toThrow(/not JSON/);
    expect(() => catalog.setList("blocks", Buffer.alloc(1024 * 1024 + 1, 32))).toThrow(/at most/);
  });

  it("refuses filters it does not know", async () => {
    const { get } = setup();
    expect((await get("/v1/catalog?game=Elden%20Ring")).status).toBe(400);
    expect((await get("/v1/catalog?workspace=yes")).status).toBe(400);
    expect((await get("/v1/catalog?game=elden-ring&workspace=1")).status).toBe(400);
    expect((await get("/v1/catalog?workspace=1")).status).toBe(200);
    expect((await get("/v1/catalog?personal=1")).status).toBe(200);
    expect((await get("/v1/catalog?personal=yes")).status).toBe(400);
    expect((await get("/v1/catalog?personal=1&workspace=1")).status).toBe(400);
    expect((await get("/v1/catalog?game=elden-ring&personal=1")).status).toBe(400);
  });

  it("answers 503 without a catalog, and 429 when a client asks too often", async () => {
    const off = createApp({ db });
    expect((await off.request("http://tavora.test/v1/catalog")).status).toBe(503);
    const busy = createApp({ db, catalog: store(), rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }) });
    expect((await busy.request("http://tavora.test/v1/catalog")).status).toBe(200);
    expect((await busy.request("http://tavora.test/v1/catalog/modules/wellbrained.timer")).status).toBe(429);
  });
});
