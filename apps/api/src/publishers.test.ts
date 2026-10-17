import { spawn } from "node:child_process";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { AccountStore, cleanDeveloperName, LINK_CODE_TTL_MS, MAX_KEYS, NAME_HOLD_MS, nameKey } from "./account-store.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint, LINK_STATEMENT } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

function setup() {
  const store = new AccountStore(":memory:");
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-17T12:00:00Z") };
  const app = createApp({ db, rateLimiter: roomy(), accounts: { store, mailer: inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => clock.now } });
  const request = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const signIn = async (email: string) => {
    await request("POST", "/v1/account/code", { email });
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
    inbox.clear();
    return ((await (await request("POST", "/v1/account/verify", { email, code, os: "windows", create: true })).json()) as { token: string }).token;
  };
  return { store, clock, request, signIn };
}

/** What `tavora-pack link` sends for a key and a code. */
function linkBody(key: KeyObject, code: string) {
  const raw = key.export({ format: "der", type: "spki" }).subarray(12);
  const signature = sign(null, Buffer.from(`${LINK_STATEMENT}\n${code}`, "utf8"), generateKeyPairSync("ed25519").privateKey);
  return { raw, body: { code, publicKey: raw.toString("base64"), signature: signature.toString("base64") } };
}

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  return {
    fingerprint: keyFingerprint(raw),
    body: (code: string) => ({ code, publicKey: raw.toString("base64"), signature: sign(null, Buffer.from(`${LINK_STATEMENT}\n${code}`, "utf8"), privateKey).toString("base64") }),
  };
}

describe("the link statement", () => {
  // The pack command signs exactly this text (packages/pack link.ts); both sides pin it.
  it("is the agreed one", () => expect(LINK_STATEMENT).toBe("tavora-key-link-1"));
});

describe("the real tavora-pack link command", () => {
  it("links a key against a running service, and players then see the name", async () => {
    const { request, signIn, store, clock } = setup();
    const token = await signIn("cli@example.com");
    await request("PUT", "/v1/account/developer", { name: "cli-dev" }, token);
    const { code } = (await (await request("POST", "/v1/account/keys/code", {}, token)).json()) as { code: string };
    const app = createApp({ db, rateLimiter: roomy(), accounts: { store, mailer: createTestInbox(), codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => clock.now } });
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const keyFile = path.join(await mkdtemp(path.join(tmpdir(), "tavora-link-")), "publisher-key.pem");
    const cli = fileURLToPath(new URL("../../../packages/pack/src/cli.ts", import.meta.url));
    try {
      const run = (code: string) =>
        new Promise<{ status: number | null; out: string }>((resolve) => {
          const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", cli, "link", code, "--key", keyFile, "--api", `http://127.0.0.1:${port}`]);
          let out = "";
          child.stdout.on("data", (chunk: Buffer) => (out += chunk));
          child.stderr.on("data", (chunk: Buffer) => (out += chunk));
          child.on("close", (status) => resolve({ status, out }));
        });
      const linked = await run(`${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`);
      expect(linked.out).toContain('Players now see your modules as "by cli-dev".');
      expect(linked.status).toBe(0);
      const fingerprintLine = /Linked publisher key ([0-9a-f]{32})/.exec(linked.out)?.[1] ?? "";
      expect(store.publisherName(fingerprintLine)).toBe("cli-dev");
      // The code is used up.
      const again = await run(code);
      expect(again.status).toBe(1);
      expect(again.out).toContain("wrong or has expired");
    } finally {
      server.close();
    }
  }, 30_000);
});

describe("developer names", () => {
  it("are 3 to 32 plain characters", () => {
    expect(cleanDeveloperName("  wellbrained ")).toBe("wellbrained");
    expect(cleanDeveloperName("Well Brained_2.0")).toBe("Well Brained_2.0");
    for (const bad of ["ab", "x".repeat(33), "-dash", "dash-", "two  spaces", "a--b", "wеllbrained", "name‮", "emoji😀", 7, null]) expect(cleanDeveloperName(bad)).toBeNull();
  });

  it("count as the same whatever their case, spaces, dots, dashes or underscores", () => {
    expect(nameKey("Well Brained")).toBe(nameKey("well_brained"));
    expect(nameKey("W.e-l l")).toBe("well");
  });

  it("are unique, never Tavora's, and change once in 30 days; a name given up stays blocked for others", async () => {
    const { request, signIn, clock } = setup();
    const first = await signIn("first@example.com");
    const second = await signIn("second@example.com");
    const put = (token: string, name: string) => request("PUT", "/v1/account/developer", { name }, token);

    expect(await (await request("GET", "/v1/account/developer", undefined, first)).json()).toEqual({ developer: null, keys: [] });
    const set = await put(first, "wellbrained");
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ developer: { name: "wellbrained", changedAt: "2026-10-17T12:00:00.000Z", nextChangeAt: "2026-11-16T12:00:00.000Z" } });

    expect(await (await put(second, "Well-Brained")).json()).toMatchObject({ reason: "name-taken" });
    for (const name of ["Tavora Team", "the-real-tavora", "admin", "Official"]) expect(await (await put(second, name)).json()).toMatchObject({ reason: "name-reserved" });
    expect(await (await put(second, "x")).json()).toMatchObject({ reason: "bad-name" });

    // The same name again is fine; another one has to wait.
    expect((await put(first, "wellbrained")).status).toBe(200);
    expect(await (await put(first, "brainwell")).json()).toMatchObject({ reason: "name-too-soon", nextChangeAt: "2026-11-16T12:00:00.000Z" });

    clock.now += NAME_HOLD_MS;
    expect((await put(first, "brainwell")).status).toBe(200);
    // The old name is held for 30 days: not for others, but its owner may take it back later.
    expect(await (await put(second, "wellbrained")).json()).toMatchObject({ reason: "name-taken" });
    clock.now += NAME_HOLD_MS;
    expect((await put(second, "wellbrained")).status).toBe(200);
  });
});

describe("linking a publisher key", () => {
  it("needs a developer name, a fresh code and the key's own signature, and keeps only the public half", async () => {
    const { request, signIn, store } = setup();
    const token = await signIn("dev@example.com");
    expect(await (await request("POST", "/v1/account/keys/code", {}, token)).json()).toMatchObject({ reason: "no-developer-name" });
    await request("PUT", "/v1/account/developer", { name: "example-dev" }, token);

    const { code, expiresAt } = (await (await request("POST", "/v1/account/keys/code", {}, token)).json()) as { code: string; expiresAt: string };
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(expiresAt).toBe("2026-10-17T12:10:00.000Z");

    const key = pair();
    // A signature by another key does not link, and does not use the code up.
    const forged = linkBody(generateKeyPairSync("ed25519").publicKey, code);
    expect(await (await request("POST", "/v1/publishers/link", forged.body)).json()).toMatchObject({ reason: "bad-signature" });

    const linked = await request("POST", "/v1/publishers/link", key.body(code));
    expect(await linked.json()).toEqual({ status: "linked", fingerprint: key.fingerprint, name: "example-dev" });
    expect(await (await request("GET", "/v1/account/developer", undefined, token)).json()).toMatchObject({ keys: [{ fingerprint: key.fingerprint, linkedAt: "2026-10-17T12:00:00.000Z" }] });
    // A code works once.
    expect(await (await request("POST", "/v1/publishers/link", key.body(code))).json()).toMatchObject({ reason: "wrong-code" });

    // Players learn the name and nothing else.
    const lookup = await request("GET", `/v1/publishers/${key.fingerprint}`);
    expect(await lookup.json()).toEqual({ name: "example-dev" });
    expect(lookup.headers.get("cache-control")).toBe("public, max-age=3600");
    expect((await request("GET", `/v1/publishers/${"0".repeat(32)}`)).status).toBe(404);
    expect((await request("GET", "/v1/publishers/not-a-key")).status).toBe(400);
    expect(store.publisherName(key.fingerprint)).toBe("example-dev");
  });

  it("refuses an expired code, a key another account linked, and more than the keys an account may have", async () => {
    const { request, signIn, clock } = setup();
    const one = await signIn("one@example.com");
    const two = await signIn("two@example.com");
    await request("PUT", "/v1/account/developer", { name: "one-dev" }, one);
    await request("PUT", "/v1/account/developer", { name: "two-dev" }, two);
    const code = async (token: string) => ((await (await request("POST", "/v1/account/keys/code", {}, token)).json()) as { code: string }).code;
    const key = pair();

    const old = await code(one);
    clock.now += LINK_CODE_TTL_MS;
    expect(await (await request("POST", "/v1/publishers/link", key.body(old))).json()).toMatchObject({ reason: "wrong-code" });

    expect((await request("POST", "/v1/publishers/link", key.body(await code(one)))).status).toBe(200);
    expect(await (await request("POST", "/v1/publishers/link", key.body(await code(two)))).json()).toMatchObject({ reason: "key-taken" });
    // Linking the same key to its own account again is fine.
    expect((await request("POST", "/v1/publishers/link", key.body(await code(one)))).status).toBe(200);

    for (let i = 1; i < MAX_KEYS; i++) expect((await request("POST", "/v1/publishers/link", pair().body(await code(one)))).status).toBe(200);
    expect(await (await request("POST", "/v1/publishers/link", pair().body(await code(one)))).json()).toMatchObject({ reason: "too-many-keys" });
  });

  it("refuses malformed bodies before looking at any code", async () => {
    const { request } = setup();
    const key = pair();
    for (const body of [{}, { ...key.body("ABCDEFGH"), code: "abc" }, { ...key.body("ABCDEFGH"), publicKey: "short" }, { ...key.body("ABCDEFGH"), signature: "x" }]) {
      expect((await request("POST", "/v1/publishers/link", body)).status).toBe(400);
    }
  });

  it("lets the owner unlink a key, and forgets keys and holds the name when the account is deleted", async () => {
    const { request, signIn, store, clock } = setup();
    const token = await signIn("dev@example.com");
    await request("PUT", "/v1/account/developer", { name: "leaving-dev" }, token);
    const key = pair();
    const code = ((await (await request("POST", "/v1/account/keys/code", {}, token)).json()) as { code: string }).code;
    await request("POST", "/v1/publishers/link", key.body(code));

    expect((await request("DELETE", `/v1/account/keys/${key.fingerprint}`, undefined, token)).status).toBe(200);
    expect(store.publisherName(key.fingerprint)).toBeNull();
    expect((await request("DELETE", `/v1/account/keys/${key.fingerprint}`, undefined, token)).status).toBe(404);

    const again = ((await (await request("POST", "/v1/account/keys/code", {}, token)).json()) as { code: string }).code;
    await request("POST", "/v1/publishers/link", key.body(again));
    const account = store.accountByEmail("dev@example.com")!;
    store.deleteAccount(account.id, clock.now);
    expect(store.publisherName(key.fingerprint)).toBeNull();
    const other = await signIn("other@example.com");
    expect(await (await request("PUT", "/v1/account/developer", { name: "leaving-dev" }, other)).json()).toMatchObject({ reason: "name-taken" });
  });
});
