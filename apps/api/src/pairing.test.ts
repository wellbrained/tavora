import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { PAIRING_TTL_MS } from "./pairing.ts";
import { createRateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const key = () => randomBytes(32).toString("base64url");

function setup() {
  let time = Date.parse("2026-10-20T12:00:00Z");
  const store = new AccountStore(":memory:");
  const inbox = createTestInbox();
  const app = createApp({ db, rateLimiter: roomy(), accounts: { store, mailer: inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => time } });
  const json = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test/v1/account${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const signIn = async (email: string, name: string) => {
    await json("POST", "/code", { email });
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails().at(-1)?.text ?? "")?.[1] ?? "";
    inbox.clear();
    return ((await (await json("POST", "/verify", { email, code, create: true, os: "windows", name })).json()) as { token: string }).token;
  };
  const read = async (token: string) => {
    const response = await json("GET", "/pairing", undefined, token);
    return response.status === 204 ? null : ((await response.json()) as Record<string, unknown>);
  };
  return { json, signIn, read, wait: (ms: number) => (time += ms) };
}

describe("approving a new PC", () => {
  it("passes the four steps between the two PCs, and the sealed key to the new PC once", async () => {
    const { json, signIn, read } = setup();
    const old = await signIn("me@example.com", "Desk");
    const fresh = await signIn("me@example.com", "Laptop");
    const third = await signIn("me@example.com", "Couch");
    const commit = key();
    const asked = (await (await json("POST", "/pairing", { commit }, fresh)).json()) as { id: string };
    expect(asked.id).toMatch(/^[A-Za-z0-9_-]{16}$/);

    expect(await read(old)).toMatchObject({ id: asked.id, own: false, name: "Laptop", commit });
    expect(await read(fresh)).toMatchObject({ own: true });
    // The new PC can't answer itself, nor show its key before an answer.
    expect((await json("POST", `/pairing/${asked.id}/answer`, { publicKey: key() }, fresh)).status).toBe(409);
    expect((await json("POST", `/pairing/${asked.id}/reveal`, { publicKey: key() }, fresh)).status).toBe(409);

    const oldKey = key();
    expect((await json("POST", `/pairing/${asked.id}/answer`, { publicKey: oldKey }, old)).status).toBe(204);
    // The first answer wins; the other PCs no longer see the request.
    expect((await json("POST", `/pairing/${asked.id}/answer`, { publicKey: key() }, third)).status).toBe(409);
    expect(await read(third)).toBeNull();
    expect(await read(fresh)).toMatchObject({ answer: { name: "Desk", publicKey: oldKey } });

    const freshKey = key();
    expect((await json("POST", `/pairing/${asked.id}/key`, { sealed: key() }, old)).status).toBe(409);
    expect((await json("POST", `/pairing/${asked.id}/reveal`, { publicKey: freshKey }, fresh)).status).toBe(204);
    expect(await read(old)).toMatchObject({ reveal: freshKey });
    // Only the PC that answered sends the key.
    expect((await json("POST", `/pairing/${asked.id}/key`, { sealed: key() }, third)).status).toBe(409);
    const sealed = randomBytes(61).toString("base64url");
    expect((await json("POST", `/pairing/${asked.id}/key`, { sealed }, old)).status).toBe(204);
    expect(await read(old)).not.toHaveProperty("sealed");
    expect(await read(fresh)).toMatchObject({ sealed });
    expect(await read(fresh)).toBeNull();
    expect(await read(old)).toBeNull();
  });

  it("tells the new PC when the other PC said no, and ends requests after ten minutes", async () => {
    const { json, signIn, read, wait } = setup();
    const old = await signIn("me@example.com", "Desk");
    const fresh = await signIn("me@example.com", "Laptop");
    const { id } = (await (await json("POST", "/pairing", { commit: key() }, fresh)).json()) as { id: string };
    expect((await json("DELETE", `/pairing/${id}`, undefined, old)).status).toBe(204);
    expect(await read(old)).toBeNull();
    expect((await json("POST", `/pairing/${id}/answer`, { publicKey: key() }, old)).status).toBe(404);
    expect(await read(fresh)).toEqual({ id, own: true, declined: true });
    expect(await read(fresh)).toBeNull();

    await json("POST", "/pairing", { commit: key() }, fresh);
    wait(PAIRING_TTL_MS + 1);
    expect(await read(old)).toBeNull();
    expect(await read(fresh)).toBeNull();
  });

  it("keeps one request per account, and only for the account's own PCs", async () => {
    const { json, signIn, read } = setup();
    const fresh = await signIn("me@example.com", "Laptop");
    const stranger = await signIn("other@example.com", "Theirs");
    const first = (await (await json("POST", "/pairing", { commit: key() }, fresh)).json()) as { id: string };
    const second = (await (await json("POST", "/pairing", { commit: key() }, fresh)).json()) as { id: string };
    expect(second.id).not.toBe(first.id);
    expect(await read(fresh)).toMatchObject({ id: second.id });
    expect(await read(stranger)).toBeNull();
    expect((await json("POST", `/pairing/${second.id}/answer`, { publicKey: key() }, stranger)).status).toBe(404);
    expect((await json("POST", `/pairing/${first.id}/answer`, { publicKey: key() }, fresh)).status).toBe(404);
  });

  it("refuses requests without a sign-in, and bodies that are off", async () => {
    const { json, signIn } = setup();
    expect(await (await json("GET", "/pairing")).json()).toMatchObject({ reason: "signed-out" });
    const fresh = await signIn("me@example.com", "Laptop");
    expect((await json("POST", "/pairing", { commit: "short" }, fresh)).status).toBe(400);
    expect((await json("POST", "/pairing", { commit: "x".repeat(2000) }, fresh)).status).toBe(413);
  });
});
