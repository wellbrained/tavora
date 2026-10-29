import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { optionalSignIn, requireSignIn, tooMany, type MaybeSignedInEnv, type SignedInEnv } from "./sign-in.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");

function setup() {
  const store = new AccountStore(":memory:");
  const account = store.createAccount({ email: "mara@example.com" }, NOW);
  const { token } = store.createSession(account.id, "windows", NOW);
  const required = new Hono<SignedInEnv>().use("*", requireSignIn(store, () => NOW)).get("/", (context) => context.json({ id: context.get("account").id }));
  const optional = new Hono<MaybeSignedInEnv>().use("*", optionalSignIn(store, () => NOW)).get("/", (context) => context.json({ id: context.get("account")?.id ?? null }));
  const ask = (app: Hono<never>, authorization?: string) => app.request("http://tavora.test/", authorization === undefined ? {} : { headers: { authorization } });
  return { store, account, token, required: required as unknown as Hono<never>, optional: optional as unknown as Hono<never>, ask };
}

describe("the sign-in gate", () => {
  it("lets a signed-in account through, keeps its answers out of caches, and refuses everything else the same way", async () => {
    const { account, token, required, ask } = setup();
    const ok = await ask(required, `Bearer ${token}`);
    expect(await ok.json()).toEqual({ id: account.id });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    for (const header of [undefined, "", `Bearer ${"x".repeat(43)}`, `Basic ${token}`, `Bearer ${token} extra`]) {
      const refused = await ask(required, header);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ error: "Sign in again.", reason: "signed-out" });
    }
  });

  it("signs out a suspended account", async () => {
    const { store, account, token, required, ask } = setup();
    store.suspend(account.id, "spam", null, NOW);
    expect((await ask(required, `Bearer ${token}`)).status).toBe(401);
  });

  it("lets a guest in without a header, but not with a token that doesn't work", async () => {
    const { account, token, optional, ask } = setup();
    expect(await (await ask(optional)).json()).toEqual({ id: null });
    expect(await (await ask(optional, `Bearer ${token}`)).json()).toEqual({ id: account.id });
    expect((await ask(optional, `Bearer ${"x".repeat(43)}`)).status).toBe(401);
  });

  it("says how long to wait when there were too many requests", async () => {
    const app = new Hono().get("/", (context) => tooMany(context, 30));
    const answer = await app.request("http://tavora.test/");
    expect(answer.status).toBe(429);
    expect(answer.headers.get("retry-after")).toBe("30");
    expect(await answer.json()).toEqual({ error: "Too many requests. Try again later.", reason: "too-many" });
  });
});
