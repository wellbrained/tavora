import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { MAX_VAULT_BYTES } from "./vault.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

function setup() {
  const store = new AccountStore(":memory:");
  const inbox = createTestInbox();
  const app = createApp({ db, rateLimiter: roomy(), accounts: { store, mailer: inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy() } });
  const json = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test/v1/account${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const vault = (method: string, token: string | null, body?: Uint8Array, type = "application/octet-stream") =>
    app.request("http://tavora.test/v1/account/vault", {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": type } : {}) },
      ...(body ? { body } : {}),
    });
  const signIn = async (email: string) => {
    await json("POST", "/code", { email });
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
    inbox.clear();
    return ((await (await json("POST", "/verify", { email, code, create: true })).json()) as { token: string }).token;
  };
  return { store, json, vault, signIn };
}

/** A new vault's body: the version it started from, then the sealed bytes. */
function put(base: number, data: Uint8Array) {
  const out = new Uint8Array(4 + data.length);
  new DataView(out.buffer).setUint32(0, base);
  out.set(data, 4);
  return out;
}

describe("the key vault", () => {
  it("keeps one sealed vault per account, and only takes a version made from the current one", async () => {
    const { vault, signIn } = setup();
    const me = await signIn("me@example.com");
    expect(await (await vault("GET", me)).json()).toMatchObject({ reason: "no-vault" });

    const first = new Uint8Array(randomBytes(200));
    expect(await (await vault("PUT", me, put(0, first))).json()).toEqual({ version: 1 });
    const got = await vault("GET", me);
    expect(got.headers.get("x-vault-version")).toBe("1");
    expect(got.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await got.arrayBuffer()).equals(Buffer.from(first))).toBe(true);

    // Another PC that started from nothing (or an older version) is refused with the current one.
    const stale = await vault("PUT", me, put(0, new Uint8Array(randomBytes(50))));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: "vault-changed", version: 1 });
    expect(await (await vault("PUT", me, put(1, new Uint8Array(randomBytes(50))))).json()).toEqual({ version: 2 });

    // Someone else's sign-in sees only their own.
    const other = await signIn("other@example.com");
    expect((await vault("GET", other)).status).toBe(404);

    expect((await vault("DELETE", me)).status).toBe(204);
    expect((await vault("GET", me)).status).toBe(404);
  });

  it("refuses requests without a sign-in, and bodies that are off", async () => {
    const { vault, signIn } = setup();
    expect(await (await vault("GET", null)).json()).toMatchObject({ reason: "signed-out" });
    expect((await vault("PUT", "x".repeat(30), put(0, new Uint8Array(10)))).status).toBe(401);
    const me = await signIn("me@example.com");
    expect((await vault("PUT", me, put(0, new Uint8Array(10)), "application/json")).status).toBe(415);
    expect((await vault("PUT", me, new Uint8Array(4))).status).toBe(400);
    expect((await vault("PUT", me, put(0, new Uint8Array(MAX_VAULT_BYTES + 1)))).status).toBe(413);
    expect((await vault("PUT", me, put(0, new Uint8Array(MAX_VAULT_BYTES)))).status).toBe(200);
  });

  it("goes with the account", async () => {
    const { store, vault, signIn } = setup();
    const me = await signIn("me@example.com");
    await vault("PUT", me, put(0, new Uint8Array(randomBytes(20))));
    const accountId = store.sessionByToken(me, Date.now())!.accountId;
    expect(store.vault(accountId)).not.toBeNull();
    store.deleteAccount(accountId);
    expect(store.vault(accountId)).toBeNull();
  });
});
