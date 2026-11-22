import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./catalog-client";
import { Installed, type InstalledModules } from "./installed-modules";
import { addWorkspace, emptyLibrary, MAX_ASKED_MODULES, type Library } from "./library";
import { UserError } from "./messages";
import { ModuleCatalog, type CatalogPort, type ModuleCatalogOptions } from "./module-catalog";
import type { InstalledModule } from "./registry";

const KEY = "a".repeat(32);
const NOW = new Date("2026-11-22T12:00:00Z");

function module(id: string, more: Record<string, unknown> = {}, root = `/modules/${id}`): InstalledModule {
  return { owner: KEY, root, provenance: "catalog", manifest: { id, name: id, version: "1.2.0", ...more } } as unknown as InstalledModule;
}

function entry(id: string, more: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id, owner: "b".repeat(32), name: id, description: null, version: "2.0.0", zip: { sha256: "c".repeat(64) }, shots: [], icon: null, games: [], gameInfo: [], personalWorkspaces: false, homepage: null, support: null, ...more } as unknown as CatalogEntry;
}

interface Setup {
  library?: Library;
  modules?: InstalledModule[];
  catalog?: string[];
  online?: boolean;
  token?: string | null;
  port?: Partial<CatalogPort>;
  shown?: string | null;
  userData?: string;
  sent?: boolean;
  openExternal?: boolean;
  check?: Awaited<ReturnType<ModuleCatalogOptions["updates"]["check"]>>;
}

function setup(options: Setup = {}) {
  const calls: string[] = [];
  const library = options.library ?? emptyLibrary();
  library.onlineSearch = options.online ?? true;
  const found: InstalledModules = { modules: new Map((options.modules ?? []).map((item) => [item.manifest.id, item])), blocked: new Map(), catalog: new Set(options.catalog ?? []), info: new Map(), problems: [] };
  const fail = (what: string) => () => Promise.reject(new Error(`${what} was not expected`));
  const port: CatalogPort = {
    list: async (scope) => (calls.push(`list ${JSON.stringify(typeof scope === "function" ? scope() : scope)}`), { status: "ok", modules: [] }),
    index: fail("index"),
    module: fail("module"),
    details: fail("details"),
    picture: async () => null,
    icon: async (id) => `icon:${id}`,
    report: async (report, token, why) => void calls.push(`report ${JSON.stringify(report)} ${token} ${why?.reason}`),
    reviews: fail("reviews"),
    reviewerPicture: async (id) => `picture:${id}`,
    ownReview: async () => ({ mine: null, own: false }),
    rate: async (id, token, rating) => void calls.push(`rate ${id} ${token} ${JSON.stringify(rating)}`),
    unrate: async (id, token) => void calls.push(`unrate ${id} ${token}`),
    reply: async (id, token, text) => void calls.push(`reply ${id} ${token} ${text}`),
    reportReview: async (id, token) => void calls.push(`report review ${id} ${token}`),
    ...options.port,
  } as CatalogPort;
  const catalog = new ModuleCatalog({
    library,
    saveLibrary: () => void calls.push("library saved"),
    installed: new Installed(found, (manifest) => ({ ...manifest, name: `shown ${manifest.name}` })),
    catalog: port,
    userData: options.userData ?? "/nowhere",
    token: () => (options.token === undefined ? "token" : options.token),
    waitingVersions: async () => [],
    updates: { check: async () => options.check ?? { updated: [], waiting: [] } },
    language: () => "en",
    shownWorkspace: () => options.shown ?? null,
    openLink: (url) => void calls.push(`link ${url}`),
    openExternal: options.openExternal === false ? null : (url) => void calls.push(`external ${url}`),
    sendRequest: async (game, installId) => (calls.push(`ask ${game.name} ${installId}`), options.sent ?? true),
    notify: (message) => void calls.push(`notice ${message}`),
    changed: () => void calls.push("changed"),
    changedSoon: () => void calls.push("changed soon"),
    checks: false,
  });
  return { catalog, calls, library };
}

describe("ModuleCatalog", () => {
  it("browses the modules for the shown workspace's game, a personal workspace, or a game a page names", async () => {
    const library = emptyLibrary();
    const valheim = addWorkspace(library, { catalogId: "valheim" }, NOW);
    const desk = addWorkspace(library, { personal: "Desk" }, NOW);
    const { catalog, calls } = setup({ library, shown: valheim });

    await catalog.browse(undefined);
    await catalog.browse({ workspaceId: desk });
    await catalog.browse({ game: "enshrouded" });

    expect(calls).toEqual([`list {"games":["valheim"]}`, `list {"personal":true}`, `list {"games":["enshrouded"]}`]);
  });

  it("says it can't tell for a workspace it can't find, lists nothing with none shown, and asks nothing while offline", async () => {
    const { catalog, calls } = setup();
    expect(await catalog.browse({ workspaceId: "gone" })).toEqual({ status: "unavailable" });
    expect(await catalog.browse(undefined)).toEqual({ status: "ok", modules: [] });
    expect(await setup({ online: false }).catalog.browse({ game: "valheim" })).toEqual({ status: "off" });
    expect(await setup({ online: false }).catalog.forGames()).toEqual({ status: "off" });
    expect(calls).toEqual([]);
  });

  it("shows a module's page with its readme and the screenshots that load, and says why one can't load", async () => {
    const shots = [{ sha256: "1" }, { sha256: "2" }];
    const details = async () => ({ entry: entry("wellbrained.map", { shots } as never), versions: [], readme: "# Map\n\nFind your way." });
    const { catalog } = setup({ port: { details, picture: async (shot) => (shot.sha256 === "1" ? "data:image/png;base64,AA" : null) } as Partial<CatalogPort> });
    const page = await catalog.page("wellbrained.map");
    expect(page).toMatchObject({ status: "ok", screenshots: ["data:image/png;base64,AA"], versions: [] });
    expect(page.status === "ok" && page.readme.length).toBeGreaterThan(0);

    const failing = (key: ConstructorParameters<typeof UserError>[0]) => setup({ port: { details: () => Promise.reject(new UserError(key)) } }).catalog.page("wellbrained.map");
    expect(await failing("error.catalogNotListed")).toEqual({ status: "gone" });
    expect(await failing("error.catalogUnavailable")).toEqual({ status: "unavailable" });
    expect(await failing("error.catalogBusy")).toEqual({ status: "busy" });
    // Reviews being down says nothing about the page.
    expect(await failing("error.reviewsUnavailable")).toEqual({ status: "unreachable" });
    expect(await setup({ online: false }).catalog.page("wellbrained.map")).toEqual({ status: "off" });
  });

  it("shows reviews with each reviewer's picture and what the user can do", async () => {
    const review = { id: "r1", stars: 4, text: "Nice", author: { name: "Ann", picture: { sha256: "d", size: 10 } } };
    const reviews = async () => ({ rating: { average: 4, count: 1 }, reviews: [review] });
    const port = { reviews, ownReview: async () => ({ mine: null, own: true }) } as unknown as Partial<CatalogPort>;
    const own = await setup({ port, modules: [module("wellbrained.map")] }).catalog.reviews("wellbrained.map");
    expect(own).toMatchObject({ status: "ok", can: "own", installedVersion: "1.2.0", reviews: [{ id: "r1", author: { name: "Ann", picture: "picture:r1" } }] });

    expect(await setup({ port: { reviews } as unknown as Partial<CatalogPort>, token: null }).catalog.reviews("wellbrained.map")).toMatchObject({ can: "sign-in", installedVersion: null });
    expect(await setup({ port: { reviews } as unknown as Partial<CatalogPort> }).catalog.reviews("wellbrained.map")).toMatchObject({ can: "rate" });
    expect(await setup({ port: { reviews: () => Promise.reject(new UserError("error.reviewsUnavailable")) } }).catalog.reviews("wellbrained.map")).toEqual({ status: "unavailable" });
  });

  it("asks for a module once per game, with an install id made once, and says when the vote can't go", async () => {
    const { catalog, calls, library } = setup();
    await catalog.ask({ name: "Grounded", steamAppId: 962130, gameId: null });
    const id = library.installId;
    expect(id).toBeTruthy();
    expect(calls).toEqual(["library saved", `ask Grounded ${id}`, "library saved"]);

    calls.length = 0;
    await catalog.ask({ name: "Grounded", steamAppId: 962130, gameId: null });
    expect(calls).toEqual([]);

    await expect(setup({ sent: false }).catalog.ask({ name: "Raft", steamAppId: null, gameId: null })).rejects.toMatchObject({ key: "error.askModuleFailed" });
    await expect(setup({ online: false }).catalog.ask({ name: "Raft", steamAppId: null, gameId: null })).rejects.toMatchObject({ key: "error.askModuleOff" });
    await expect(catalog.ask({ name: "", steamAppId: null, gameId: null })).rejects.toMatchObject({ key: "error.askModuleFailed" });
  });

  it("remembers only the newest asked games", async () => {
    const library = emptyLibrary();
    library.askedModules = Array.from({ length: MAX_ASKED_MODULES }, (_, index) => `name:game ${index}`);
    const { catalog } = setup({ library });
    await catalog.ask({ name: "Raft", steamAppId: null, gameId: null });
    expect(library.askedModules).toHaveLength(MAX_ASKED_MODULES);
    expect(library.askedModules.at(-1)).not.toBe("name:game 0");
  });

  it("reports the zip installed from the catalog, else the version listed now, and only signed in and online", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "tavora-report-"));
    await writeFile(path.join(userData, "module-owners.json"), JSON.stringify({ version: 1, folders: { "wellbrained.map": { id: "wellbrained.map", owner: KEY, sha256: "e".repeat(64), catalog: true } } }));
    const installed = setup({ userData, modules: [module("wellbrained.map", {}, "/modules/wellbrained.map")], catalog: ["wellbrained.map"] });
    await installed.catalog.report("wellbrained.map", { reason: "harmful", note: null });
    expect(installed.calls).toEqual([`report {"id":"wellbrained.map","owner":"${KEY}","sha256":"${"e".repeat(64)}"} token harmful`]);

    const listed = setup({ userData, port: { module: async (id) => entry(id) } });
    await listed.catalog.report("wellbrained.other", { reason: "other", note: "x" });
    expect(listed.calls).toEqual([`report {"id":"wellbrained.other","owner":"${"b".repeat(32)}","sha256":"${"c".repeat(64)}"} token other`]);

    await expect(setup({ token: null }).catalog.report("wellbrained.map", { reason: "other", note: null })).rejects.toMatchObject({ key: "error.reportSignIn" });
    await expect(setup({ online: false }).catalog.report("wellbrained.map", { reason: "other", note: null })).rejects.toMatchObject({ key: "error.reportOff" });
  });

  it("opens only the web addresses the listing or the module names: a homepage, a support link, a readme's link", async () => {
    const port = {
      module: async (id: string) => entry(id, { homepage: id === "wellbrained.ftp" ? "ftp://example.com" : "https://example.com/map", support: "help@example.com" }),
      details: async (id: string) => ({ entry: entry(id), versions: [], readme: "See [the wiki](https://wiki.example.com/map)." }),
    } as unknown as Partial<CatalogPort>;
    const { catalog, calls } = setup({ port, modules: [module("wellbrained.map", { support: "https://help.example.com" })] });

    await catalog.openHomepage("wellbrained.map");
    await catalog.openHomepage("wellbrained.ftp");
    await catalog.openSupport("wellbrained.map", "installed");
    await catalog.openSupport("wellbrained.listed", "catalog");
    await catalog.openReadmeLink("wellbrained.map", "https://wiki.example.com/map");
    await expect(catalog.openReadmeLink("wellbrained.map", "https://evil.example.com")).rejects.toMatchObject({ key: "error.readmeLink" });

    expect(calls).toEqual(["link https://example.com/map", "link https://help.example.com", "external mailto:help@example.com", "link https://wiki.example.com/map"]);
    await expect(setup({ online: false }).catalog.openHomepage("wellbrained.map")).rejects.toMatchObject({ key: "error.catalogOff" });
  });

  it("opens no mail app in a test run", async () => {
    const { catalog, calls } = setup({ openExternal: false, modules: [module("wellbrained.map", { support: "help@example.com" })] });
    await catalog.openSupport("wellbrained.map", "installed");
    expect(calls).toEqual([]);
  });

  it("rates the installed version only when the catalog published it, else the newest published one", async () => {
    const details = async (id: string) => ({ entry: entry(id), versions: [{ version: "1.10.0" }, { version: "1.2.0" }, { version: "1.9.0" }], readme: null });
    const installed = setup({ port: { details } as unknown as Partial<CatalogPort>, modules: [module("wellbrained.map")] });
    await installed.catalog.rate("wellbrained.map", 5, "  Great  ");
    expect(installed.calls).toEqual([`rate wellbrained.map token {"stars":5,"text":"Great","version":"1.2.0"}`]);

    const newest = setup({ port: { details } as unknown as Partial<CatalogPort> });
    await newest.catalog.rate("wellbrained.map", 3, "   ");
    expect(newest.calls).toEqual([`rate wellbrained.map token {"stars":3,"text":null,"version":"1.10.0"}`]);

    const unpublished = setup({ port: { details } as unknown as Partial<CatalogPort>, modules: [module("wellbrained.map", { version: "1.3.0" })] });
    await expect(unpublished.catalog.rate("wellbrained.map", 5, null)).rejects.toMatchObject({ key: "error.reviewVersion" });
    await expect(setup({ token: null }).catalog.rate("wellbrained.map", 5, null)).rejects.toMatchObject({ key: "account.error.signedOut" });
  });

  it("takes a rating back, replies and reports a review only signed in and online", async () => {
    const { catalog, calls } = setup();
    await catalog.unrate("wellbrained.map");
    await catalog.reply("r1", "  Thanks!  ");
    await catalog.reply("r2", "   ");
    await catalog.reportReview("r3");
    expect(calls).toEqual(["unrate wellbrained.map token", "reply r1 token Thanks!", "reply r2 token null", "report review r3 token"]);

    await expect(setup({ token: null }).catalog.unrate("wellbrained.map")).rejects.toMatchObject({ key: "account.error.signedOut" });
    await expect(setup({ online: false }).catalog.reply("r1", "x")).rejects.toMatchObject({ key: "error.catalogOff" });
    expect(() => setup({ token: null }).catalog.reportReview("r3")).toThrow(expect.objectContaining({ key: "error.reportSignIn" }));
  });

  it("says which module an update check updated, or how many, and never checks offline", async () => {
    const one = setup({ check: { updated: [{ manifest: { id: "wellbrained.map", name: "Map", version: "2.0.0" } }], waiting: [] } as never });
    expect(await one.catalog.checkUpdates()).toEqual({ updated: 1, waiting: 0 });
    expect(one.calls).toHaveLength(2);
    expect(one.calls[0]).toMatch(/^notice .*Map.*2\.0\.0/);
    expect(one.calls[1]).toBe("changed");

    const many = setup({ check: { updated: [{ manifest: { id: "a", name: "A", version: "1.0.0" } }, { manifest: { id: "b", name: "B", version: "1.0.0" } }], waiting: [{}] } as never });
    expect(await many.catalog.checkUpdates()).toEqual({ updated: 2, waiting: 1 });
    expect(many.calls[0]).toContain("2");

    const offline = setup({ online: false });
    expect(await offline.catalog.checkUpdates()).toEqual({ updated: 0, waiting: 0 });
    expect(offline.calls).toEqual([]);
  });

  it("never says up to date when a check could not reach the catalog or download an update", async () => {
    await expect(setup({ check: { updated: [], waiting: [], unreachable: true } as never }).catalog.checkUpdatesNow()).rejects.toMatchObject({ key: "error.updatesUnreachable" });
    await expect(setup({ check: { updated: [], waiting: [], failed: 1 } as never }).catalog.checkUpdatesNow()).rejects.toMatchObject({ key: "error.updatesFailed" });
    expect(await setup({ check: { updated: [], waiting: [{}], failed: 1 } as never }).catalog.checkUpdatesNow()).toEqual({ ok: true, updated: 0, waiting: 1 });
    await expect(setup({ online: false }).catalog.checkUpdatesNow()).rejects.toMatchObject({ key: "error.catalogOff" });
  });

  it("learns the game of a workspace added by name from a listing, and saves only when it did", () => {
    const library = emptyLibrary();
    const id = addWorkspace(library, { name: "Grounded", steamAppId: 962130 }, NOW);
    const { catalog, calls } = setup({ library });

    catalog.learn([{ id: "nothing", name: "Other", steamAppId: 1 }]);
    expect(calls).toEqual([]);
    catalog.learn([{ id: "grounded", name: "Grounded", steamAppId: 962130 }]);
    expect(library.workspaces[id]!.gameId).toBe("grounded");
    expect(calls).toEqual(["library saved", "changed soon"]);
  });
});
