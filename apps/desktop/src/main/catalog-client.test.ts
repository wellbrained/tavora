import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { CatalogClient, fitsScope, parseCatalogEntry, parseCatalogReview, parseRating } from "./catalog-client";
import { installZipData } from "./installer";

const OWNER = "0123456789abcdef0123456789abcdef";
const SHA = "a".repeat(64);

const entry = (fields: Record<string, unknown> = {}) => ({
  id: "wellbrained.tracker",
  name: "Tracker",
  description: "Tracks things.",
  version: "1.2.0",
  minTavora: null,
  games: [],
  workspaces: true,
  permissions: { network: ["api.example.com"], connectors: [] },
  owner: OWNER,
  publisher: "wellbrained",
  zip: { sha256: SHA, size: 1234 },
  publishedAt: "2026-10-18T10:00:00.000Z",
  notes: ["First version."],
  ...fields,
});

/** A fetch that answers every request with one response and records the requests. */
function fakeFetch(answer: (url: string) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer(String(input));
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseCatalogEntry", () => {
  it("keeps a valid listing and leaves the hash out of the view", () => {
    expect(parseCatalogEntry(entry())).toMatchObject({ id: "wellbrained.tracker", name: "Tracker", publisher: "wellbrained", zip: { sha256: SHA, size: 1234 } });
  });

  it("keeps HTML in a description as plain text and drops hidden direction marks (C10)", () => {
    const parsed = parseCatalogEntry(entry({ name: "Tra‮ck\u0000er", description: "<img src=x onerror=alert(1)> **bold**" }));
    expect(parsed?.name).toBe("Tra ck er");
    expect(parsed?.description).toBe("<img src=x onerror=alert(1)> **bold**");
  });

  it("keeps an http or https homepage only, and well-formed screenshots, at most five (C10)", () => {
    expect(parseCatalogEntry(entry({ homepage: "https://example.com/tracker" }))?.homepage).toBe("https://example.com/tracker");
    for (const bad of ["javascript:alert(1)", "file:///C:/Windows", "tavora-module://x/", "https://user:pw@example.com", 42, `https://example.com/${"a".repeat(300)}`]) {
      expect(parseCatalogEntry(entry({ homepage: bad }))?.homepage, String(bad)).toBeNull();
    }
    const shot = (n: number, fields: Record<string, unknown> = {}) => ({ sha256: n.toString(16).repeat(64), type: "png", size: 1000, ...fields });
    const parsed = parseCatalogEntry(entry({ screenshots: [shot(1), shot(5, { type: "webp" }), shot(1), shot(2, { type: "svg" }), shot(3, { size: 2 * 1024 * 1024 }), shot(4, { sha256: "x" })] }));
    expect(parsed?.shots).toEqual([shot(1), shot(5, { type: "webp" })]);
    expect(parseCatalogEntry(entry({ screenshots: [1, 2, 3, 4, 5, 6, 7].map((n) => shot(n)) }))?.shots).toHaveLength(5);
    expect(parseCatalogEntry(entry({ screenshots: "nope" }))?.shots).toEqual([]);
  });

  it("keeps an https address or an email address as the support link, and nothing else", () => {
    expect(parseCatalogEntry(entry({ support: "https://example.com/feedback" }))?.support).toBe("https://example.com/feedback");
    expect(parseCatalogEntry(entry({ support: "feedback@example.com" }))?.support).toBe("feedback@example.com");
    expect(parseCatalogEntry(entry())?.support).toBeNull();
    for (const bad of ["http://example.com", "javascript:alert(1)", "data:text/html,hi", "mailto:a@example.com", "a?cc=x@example.com", "https://u:p@example.com", "", "hi there", 42, `https://example.com/${"a".repeat(300)}`]) {
      expect(parseCatalogEntry(entry({ support: bad }))?.support, String(bad)).toBeNull();
    }
  });

  it("shows only a developer name the service form allows, never another claim (C13)", () => {
    expect(parseCatalogEntry(entry({ publisher: "Tavora​ Official" }))?.publisher).toBeNull();
    expect(parseCatalogEntry(entry({ publisher: null }))?.publisher).toBeNull();
    expect(parseCatalogEntry(entry({ publisher: { name: "x" } }))?.publisher).toBeNull();
  });

  it("drops a listing with a bad id, owner, hash, size, version or permission", () => {
    for (const bad of [
      { id: "../evil" },
      { owner: "local" },
      { owner: "official" },
      { zip: { sha256: "xyz", size: 10 } },
      { zip: { sha256: SHA, size: 0 } },
      { zip: { sha256: SHA, size: 1e12 } },
      { version: "one" },
      { name: "   " },
      { permissions: { network: ["localhost"], connectors: [] } },
      { permissions: { network: [], connectors: ["camera"] } },
      { games: ["Not A Game!"] },
    ]) {
      expect(parseCatalogEntry(entry(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it("fits a module to a game or a personal workspace as the host does", () => {
    expect(fitsScope({ games: [], workspaces: true }, { workspace: true })).toBe(true);
    expect(fitsScope({ games: [], workspaces: false }, { workspace: true })).toBe(false);
    expect(fitsScope({ games: ["poe2"], workspaces: false }, { workspace: true })).toBe(false);
    expect(fitsScope({ games: ["poe2"], workspaces: false }, { game: "poe2" })).toBe(true);
    expect(fitsScope({ games: ["poe2"], workspaces: false }, { game: "satisfactory" })).toBe(false);
  });
});

describe("CatalogClient.list", () => {
  it("asks for the whole index with no cookies or referrer, and lists the modules that fit first", async () => {
    const { impl, calls } = fakeFetch(() =>
      json({ modules: [entry({ id: "wellbrained.another", name: "Another", games: ["satisfactory"], installs: 12 }), entry(), entry({ id: "bad id" }), entry()] }),
    );
    const result = await new CatalogClient({ baseUrl: "https://catalog.test/", fetchImpl: impl }).list({ game: "poe2" }, "en");
    expect(calls.map((call) => call.url)).toEqual(["https://catalog.test/v1/catalog"]);
    expect(calls[0]!.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    expect(result).toEqual({
      status: "ok",
      modules: [
        expect.objectContaining({ id: "wellbrained.tracker", fits: true, installs: 0 }),
        expect.objectContaining({ id: "wellbrained.another", fits: false, forGames: ["Satisfactory"], installs: 12 }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain(SHA);
  });

  it("marks modules for a game as not fitting a personal workspace", async () => {
    const { impl, calls } = fakeFetch(() => json({ modules: [entry({ games: ["poe2"] })] }));
    const result = await new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: impl }).list({ workspace: true }, "en");
    expect(calls[0]!.url).toBe("https://catalog.test/v1/catalog");
    expect(result).toEqual({ status: "ok", modules: [expect.objectContaining({ fits: false, forGames: ["Path of Exile 2"] })] });
  });

  it("shows names and descriptions in Tavora's language, sorted by the name shown", async () => {
    const translations = { de: { name: "Zeitmesser", description: "Zählt runter." }, "x-bad": { name: "Bad" }, fr: { description: 5 } };
    const { impl } = fakeFetch(() => json({ modules: [entry({ id: "wellbrained.another", name: "Another" }), entry({ name: "Tracker", translations })] }));
    const client = new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: impl });
    const german = await client.list({ game: "poe2" }, "de-at");
    expect(german).toMatchObject({ status: "ok", modules: [{ name: "Another" }, { name: "Zeitmesser", description: "Zählt runter." }] });
    expect(german).toMatchObject({ modules: [{}, expect.not.objectContaining({ translations: expect.anything() })] });
    expect(await client.list({ game: "poe2" }, "fr")).toMatchObject({ modules: [{ name: "Another" }, { name: "Tracker" }] });
    expect(parseCatalogEntry(entry({ translations }))?.translations).toEqual({ de: { name: "Zeitmesser", description: "Zählt runter." } });
  });

  it("tells the catalog about an install with only the module id, and never throws", async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: impl }).installed("wellbrained.tracker");
    expect(calls[0]!.url).toBe("https://catalog.test/v1/catalog/installed");
    expect(calls[0]!.init).toMatchObject({ method: "POST", credentials: "omit", body: JSON.stringify({ id: "wellbrained.tracker" }) });
    const offline = new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: (async () => Promise.reject(new TypeError("offline"))) as typeof fetch });
    await expect(offline.installed("wellbrained.tracker")).resolves.toBeUndefined();
  });

  it("tells the catalog about an update with only the module id, and never throws", async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: impl }).updated("wellbrained.tracker");
    expect(calls[0]!.url).toBe("https://catalog.test/v1/catalog/updated");
    expect(calls[0]!.init).toMatchObject({ method: "POST", credentials: "omit", body: JSON.stringify({ id: "wellbrained.tracker" }) });
    const offline = new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: (async () => Promise.reject(new TypeError("offline"))) as typeof fetch });
    await expect(offline.updated("wellbrained.tracker")).resolves.toBeUndefined();
    await offline.updated("not a module id");
  });

  it("says when the catalog is off, busy or unreachable", async () => {
    const client = (answer: () => Response) => new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: fakeFetch(answer).impl });
    expect(await client(() => json({}, 503)).list({ game: "poe2" }, "en")).toEqual({ status: "unavailable" });
    expect(await client(() => new Response("", { status: 429, headers: { "retry-after": "30" } })).list({ game: "poe2" }, "en")).toEqual({ status: "busy" });
    expect(await client(() => new Response("not json")).list({ game: "poe2" }, "en")).toEqual({ status: "unreachable" });
    const offline = new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: (async () => Promise.reject(new TypeError("offline"))) as typeof fetch });
    expect(await offline.list({ game: "poe2" }, "en")).toEqual({ status: "unreachable" });
  });
});

describe("CatalogClient.download", () => {
  const data = Buffer.from("zip bytes");
  const zip = { sha256: createHash("sha256").update(data).digest("hex"), size: data.length };

  it("gives back a zip that matches the listed size and hash", async () => {
    const { impl, calls } = fakeFetch(() => new Response(new Uint8Array(data)));
    expect(await new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: impl }).download(zip)).toEqual(data);
    expect(calls[0]!.url).toBe(`https://catalog.test/v1/catalog/zips/${zip.sha256}.zip`);
  });

  it("refuses a zip with another hash, or a longer one than listed, before anything uses it (C1)", async () => {
    const client = (body: Buffer) => new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: fakeFetch(() => new Response(new Uint8Array(body))).impl });
    await expect(client(Buffer.from("zip bytez")).download(zip)).rejects.toMatchObject({ key: "error.catalogBadZip" });
    await expect(client(Buffer.concat([data, Buffer.alloc(10_000)])).download(zip)).rejects.toMatchObject({ key: "error.catalogBadZip" });
    await expect(client(data.subarray(0, 3)).download(zip)).rejects.toMatchObject({ key: "error.catalogBadZip" });
  });
});

describe("CatalogClient.picture", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("picture bytes")]);
  const shot = { sha256: createHash("sha256").update(png).digest("hex"), type: "png" as const, size: png.length };
  const client = (body: Buffer) => {
    const fake = fakeFetch(() => new Response(new Uint8Array(body)));
    return { client: new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: fake.impl }), calls: fake.calls };
  };

  it("gives back a listed PNG as a data address, asked for by its hash", async () => {
    const { client: catalog, calls } = client(png);
    expect(await catalog.picture(shot)).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(calls[0]!.url).toBe(`https://catalog.test/v1/catalog/pictures/${shot.sha256}.png`);
    expect(calls[0]!.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("drops a screenshot with another hash, size or kind than listed (C10)", async () => {
    const svg = Buffer.from("<svg onload='alert(1)'></svg>");
    const svgShot = { ...shot, sha256: createHash("sha256").update(svg).digest("hex"), size: svg.length };
    expect(await client(svg).client.picture(svgShot)).toBeNull();
    expect(await client(png).client.picture({ ...shot, type: "webp" })).toBeNull();
    expect(await client(Buffer.concat([png, Buffer.from("x")])).client.picture(shot)).toBeNull();
    expect(await client(Buffer.from(png).fill(1, 20)).client.picture(shot)).toBeNull();
  });
});

describe("CatalogClient.icon", () => {
  it("fetches the icon of a module from the last list once, and nothing for others", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("icon bytes")]);
    const icon = { sha256: createHash("sha256").update(png).digest("hex"), type: "png", size: png.length };
    const { impl, calls } = fakeFetch((url) => (url.includes("/pictures/") ? new Response(new Uint8Array(png)) : json({ modules: [entry({ icon })] })));
    const client = new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: impl });
    expect(await client.icon("wellbrained.tracker")).toBeNull();
    const listed = await client.list({ game: "poe2" }, "en");
    expect(listed).toMatchObject({ status: "ok", modules: [{ icon: true }] });
    expect(await client.icon("wellbrained.tracker")).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(await client.icon("wellbrained.tracker")).not.toBeNull();
    expect(await client.icon("wellbrained.other")).toBeNull();
    expect(calls.filter((call) => call.url.includes("/pictures/"))).toHaveLength(1);
  });
});

describe("CatalogClient.report", () => {
  const report = { id: "wellbrained.tracker", owner: OWNER, sha256: SHA };

  it("sends exactly the module id, the key and the zip's hash, with no cookies or referrer (C12)", async () => {
    const { impl, calls } = fakeFetch(() => json({ status: "received" }, 202));
    await new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: impl }).report(report);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://catalog.test/v1/catalog/report");
    expect(calls[0]!.init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual(report);
  });

  it("says plainly when the module is not listed, the catalog is busy or the service is away", async () => {
    const client = (answer: () => Response) => new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: fakeFetch(answer).impl });
    await expect(client(() => json({}, 404)).report(report)).rejects.toMatchObject({ key: "error.catalogNotListed" });
    await expect(client(() => json({}, 429)).report(report)).rejects.toMatchObject({ key: "error.catalogBusy" });
    await expect(client(() => json({}, 503)).report(report)).rejects.toMatchObject({ key: "error.catalogUnavailable" });
    const offline = new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: (async () => Promise.reject(new TypeError("offline"))) as typeof fetch });
    await expect(offline.report(report)).rejects.toMatchObject({ key: "error.catalogUnreachable" });
  });

  it("sends nothing for values that are not an id, a key and a hash", async () => {
    const { impl, calls } = fakeFetch(() => json({}, 202));
    const client = new CatalogClient({ baseUrl: "https://catalog.test", fetchImpl: impl });
    await expect(client.report({ ...report, owner: "me@example.com" })).rejects.toMatchObject({ key: "error.catalogNotListed" });
    await expect(client.report({ ...report, sha256: "x" })).rejects.toMatchObject({ key: "error.catalogNotListed" });
    expect(calls).toEqual([]);
  });
});

describe("ratings and reviews", () => {
  const review = (fields: Record<string, unknown> = {}) => ({
    id: "AbCdEfGhIjKlMnOp",
    stars: 4,
    text: "Handy.\n\n\n\nWorks well.",
    version: "1.2.0",
    updatedAt: "2026-10-21T12:00:00.000Z",
    author: { name: "Mara", initials: "MA", picture: { sha256: SHA, size: 900 } },
    reply: { text: "Thanks!", updatedAt: "2026-10-21T13:00:00.000Z" },
    ...fields,
  });

  it("keeps a rating only when its counts add up and its average fits", () => {
    expect(parseRating({ average: 4.33, count: 3, stars: [0, 0, 1, 0, 2] })).toEqual({ average: 4.3, count: 3, stars: [0, 0, 1, 0, 2] });
    expect(parseCatalogEntry(entry({ rating: { average: 5, count: 1, stars: [0, 0, 0, 0, 1] } }))?.rating).toEqual({ average: 5, count: 1, stars: [0, 0, 0, 0, 1] });
    for (const bad of [null, { average: 4, count: 2, stars: [0, 0, 1, 0, 2] }, { average: 6, count: 1, stars: [0, 0, 0, 0, 1] }, { average: 4, count: 1, stars: [0, 0, 0, 1] }, { average: 4, count: 1, stars: [0, 0, 0, -1, 2] }]) {
      expect(parseRating(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("keeps a review as plain text with at most one blank line, and drops what doesn't fit", () => {
    expect(parseCatalogReview(review())).toEqual({
      id: "AbCdEfGhIjKlMnOp",
      stars: 4,
      text: "Handy.\n\nWorks well.",
      version: "1.2.0",
      date: "2026-10-21T12:00:00.000Z",
      author: { name: "Mara", initials: "MA", picture: { sha256: SHA, size: 900 } },
      reply: { text: "Thanks!", date: "2026-10-21T13:00:00.000Z" },
    });
    expect(parseCatalogReview(review({ text: "Tr\u202eap" }))?.text).toBe("Trap");
    expect(parseCatalogReview(review({ author: { name: null, initials: "XX", picture: null } }))?.author).toEqual({ name: null, initials: null, picture: null });
    for (const bad of [{ id: "short" }, { stars: 0 }, { stars: 6 }, { text: "" }, { text: null }, { version: "latest" }]) {
      expect(parseCatalogReview(review(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rates with the sign-in and turns the service's reasons into messages", async () => {
    const { impl, calls } = fakeFetch(() => json({ review: {} }));
    const client = new CatalogClient({ baseUrl: "https://api.test", fetchImpl: impl });
    await client.rate("wellbrained.tracker", "t".repeat(30), { stars: 5, text: null, version: "1.2.0" });
    expect(calls[0]!.url).toBe("https://api.test/v1/catalog/modules/wellbrained.tracker/review");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${"t".repeat(30)}`);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ stars: 5, text: null, version: "1.2.0" });
    for (const [reason, key] of [["own-module", "error.reviewOwn"], ["review-words", "error.reviewWords"], ["review-link", "error.reviewLink"], ["signed-out", "account.error.signedOut"]] as const) {
      const failing = new CatalogClient({ baseUrl: "https://api.test", fetchImpl: fakeFetch(() => json({ reason }, 400)).impl });
      await expect(failing.rate("wellbrained.tracker", "t".repeat(30), { stars: 1, text: "x", version: "1.2.0" })).rejects.toMatchObject({ key });
    }
  });

  it("reads the player's own review, held for the maintainer or hidden after a report", async () => {
    const own = (fields: Record<string, unknown>) => json({ review: { stars: 4, text: "Nice", version: "1.2.0", ...fields }, own: false });
    const read = (fields: Record<string, unknown>) => new CatalogClient({ baseUrl: "https://api.test", fetchImpl: fakeFetch(() => own(fields)).impl }).ownReview("wellbrained.tracker", "t".repeat(30));
    expect((await read({ held: true })).mine).toEqual({ stars: 4, text: "Nice", version: "1.2.0", hidden: false, held: true });
    expect((await read({ hidden: true })).mine).toMatchObject({ hidden: true, held: false });
  });

  it("reports a review by its id alone", async () => {
    const { impl, calls } = fakeFetch(() => json({ status: "received" }, 202));
    await new CatalogClient({ baseUrl: "https://api.test", fetchImpl: impl }).reportReview("AbCdEfGhIjKlMnOp");
    expect(calls[0]!.url).toBe("https://api.test/v1/catalog/reviews/AbCdEfGhIjKlMnOp/report");
    expect(calls[0]!.init?.body).toBeUndefined();
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe("a catalog install", () => {
  const manifest = JSON.stringify({ id: "wellbrained.tracker", name: "Tracker", version: "1.0.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } });
  const files: ZipFile[] = [
    { name: "tavora.module.json", data: Buffer.from(manifest) },
    { name: "dist/index.html", data: Buffer.from("<p>hi</p>") },
  ];

  async function setup() {
    const userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-catalog-")));
    const userModules = path.join(userData, "modules");
    await mkdir(userModules);
    return { userData, userModules, tavoraVersion: "0.18.0", modules: new Map() };
  }

  it("installs a zip signed by the listed key", async () => {
    const options = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const installed = await installZipData(writeZip([...files, signFiles(files, key)]), { ...options, expect: { id: "wellbrained.tracker", owner: fingerprint(key) } });
    expect(installed.owner).toBe(fingerprint(key));
    expect(await readdir(options.userModules)).toEqual(["wellbrained.tracker"]);
  });

  it("writes nothing for a zip the server swapped: another key, another module, unsigned or tampered", async () => {
    const options = await setup();
    const listed = generateKeyPairSync("ed25519").privateKey;
    const other = generateKeyPairSync("ed25519").privateKey;
    const expect_ = { id: "wellbrained.tracker", owner: fingerprint(listed) };
    const tampered = [files[0]!, { name: "dist/index.html", data: Buffer.from("<script>evil()</script>") }, signFiles(files, listed)];
    await expect(installZipData(writeZip([...files, signFiles(files, other)]), { ...options, expect: expect_ })).rejects.toMatchObject({ key: "error.installRefused" });
    await expect(installZipData(writeZip(files), { ...options, expect: expect_ })).rejects.toMatchObject({ key: "error.installRefused" });
    await expect(installZipData(writeZip(tampered), { ...options, expect: expect_ })).rejects.toMatchObject({ key: "error.installRefused" });
    await expect(installZipData(writeZip([...files, signFiles(files, listed)]), { ...options, expect: { ...expect_, id: "wellbrained.other" } })).rejects.toMatchObject({ key: "error.installRefused" });
    expect(await readdir(options.userModules)).toEqual([]);
    expect(await readdir(options.userData)).toEqual(["modules"]);
  });
});
