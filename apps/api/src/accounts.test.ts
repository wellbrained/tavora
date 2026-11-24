import { describe, expect, it, vi } from "vitest";
import { AccountStore, CODE_TTL_MS, normalizeEmail, SESSION_IDLE_MS } from "./account-store.ts";
import type { AccountOptions } from "./accounts.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { BREVO_URL, createBrevoMailer, createTestInbox, createTestInboxApp, MailLimitError, maskEmail, type Mailer } from "./mail.ts";
import { cleanDiscordName, createDiscordClient, DiscordError, type DiscordClient } from "./discord.ts";
import { encodePng } from "./png.ts";
import { createRateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

/**
 * `accounts` replaces any of the account options; a request's client is its `x-client` header ("local" without one).
 * Nothing really waits: `pauses` lists every wait asked for. `sendMs`: how long each send takes on the clock.
 */
function setup(options: { mailer?: Mailer; mailDailyLimit?: number; discord?: DiscordClient; accounts?: Partial<AccountOptions>; sendMs?: number } = {}) {
  const store = new AccountStore(":memory:");
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-16T12:00:00Z") };
  const pauses: number[] = [];
  const mailer = options.mailer ?? inbox;
  const app = createApp({
    db,
    rateLimiter: roomy(),
    clientKey: (request) => request.headers.get("x-client") ?? "local",
    accounts: {
      store,
      mailer: options.sendMs === undefined ? mailer : { send: async (mail) => ((clock.now += options.sendMs!), mailer.send(mail)) },
      pause: async (ms) => void pauses.push(ms),
      codeRateLimiter: roomy(),
      verifyRateLimiter: roomy(),
      now: () => clock.now,
      ...(options.mailDailyLimit === undefined ? {} : { mailDailyLimit: options.mailDailyLimit }),
      ...(options.discord ? { discord: options.discord } : {}),
      ...options.accounts,
    },
  });
  const call = (method: string, path: string, body?: unknown, token?: string, client?: string) =>
    app.request(`http://tavora.test/v1/account${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(client ? { "x-client": client } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const lastCode = () => /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
  /** Signs an address in, creating its account when needed, and returns the token. */
  const signIn = async (email: string, os = "windows", name?: string) => {
    await call("POST", "/code", { email });
    const answer = (await (await call("POST", "/verify", { email, code: lastCode(), os, create: true, ...(name === undefined ? {} : { name }) })).json()) as { token: string };
    return answer.token;
  };
  /** An account made a day ago (so it counts as existing for the emails kept for accounts), and a sign-in token for it. */
  const oldAccount = (email: string) => {
    const account = store.createAccount({ email }, clock.now - 24 * 60 * 60_000);
    return store.createSession(account.id, "windows", clock.now).token;
  };
  return { store, inbox, clock, app, call, lastCode, signIn, oldAccount, pauses };
}

describe("accounts switched off", () => {
  it("answers 503 without a way to send email", async () => {
    const app = createApp({ db });
    for (const path of ["/v1/account", "/v1/account/code", "/v1/account/verify"]) {
      const response = await app.request(`http://tavora.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ reason: "unavailable" });
    }
  });
});

describe("signing in with a code", () => {
  it("answers the same for a new address and one with an account, and mails a code", async () => {
    const { call, inbox, signIn } = setup();
    await signIn("known@example.com");
    inbox.clear();
    const known = await call("POST", "/code", { email: "known@example.com", language: "de" });
    const fresh = await call("POST", "/code", { email: "new@example.com" });
    expect([known.status, fresh.status]).toEqual([202, 202]);
    expect(await known.json()).toEqual(await fresh.json());
    const [toNew, toKnown] = inbox.mails();
    expect(toKnown).toMatchObject({ to: "known@example.com", subject: "Dein Tavora-Anmeldecode" });
    expect(toNew).toMatchObject({ to: "new@example.com", subject: "Your Tavora code" });
    expect(toNew!.text).toMatch(/create a Tavora account/);
  });

  it("asks before creating an account, keeping the code, then creates it", async () => {
    const { call, lastCode } = setup();
    await call("POST", "/code", { email: " New@Example.com " });
    const code = lastCode();
    const ask = await call("POST", "/verify", { email: "new@example.com", code, os: "linux" });
    expect(await ask.json()).toEqual({ status: "no-account" });
    const created = (await (await call("POST", "/verify", { email: "NEW@example.com", code, os: "linux", create: true })).json()) as Record<string, unknown>;
    expect(created).toMatchObject({ status: "created", account: { email: "new@example.com", createdAt: "2026-10-16T12:00:00.000Z" } });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The code is spent now.
    expect((await call("POST", "/verify", { email: "new@example.com", code, create: true })).status).toBe(400);
  });

  it("signs an existing account in and spends the code", async () => {
    const { call, lastCode, signIn } = setup();
    await signIn("me@example.com");
    await call("POST", "/code", { email: "me@example.com" });
    const code = lastCode();
    expect(await (await call("POST", "/verify", { email: "me@example.com", code })).json()).toMatchObject({ status: "signed-in" });
    expect(await (await call("POST", "/verify", { email: "me@example.com", code })).json()).toMatchObject({ reason: "wrong-code" });
  });

  it("spends a code after five wrong tries", async () => {
    const { call, lastCode } = setup();
    await call("POST", "/code", { email: "me@example.com" });
    const code = lastCode();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect((await call("POST", "/verify", { email: "me@example.com", code: wrong })).status).toBe(400);
    expect((await call("POST", "/verify", { email: "me@example.com", code, create: true })).status).toBe(400);
  });

  it("never lets wrong tries from another network spend someone's code, and still takes five wrong tries at most (audit 2026-11-22)", async () => {
    const { call, lastCode } = setup();
    const owner = "203.0.113.5";
    const stranger = "198.51.100.7";
    await call("POST", "/code", { email: "me@example.com" }, undefined, owner);
    const code = lastCode();
    const wrong = code === "000000" ? "000001" : "000000";
    // A stranger who knows the address guesses as long as their own limit lets them.
    for (let i = 0; i < 10; i++) expect((await call("POST", "/verify", { email: "me@example.com", code: wrong }, undefined, stranger)).status).toBe(400);
    // Three of those were checked; the rest weren't, so even the right code from there is refused now.
    expect((await call("POST", "/verify", { email: "me@example.com", code, create: true }, undefined, stranger)).status).toBe(400);
    // The owner still has their tries: one wrong, then the right one.
    expect((await call("POST", "/verify", { email: "me@example.com", code: wrong }, undefined, owner)).status).toBe(400);
    expect(await (await call("POST", "/verify", { email: "me@example.com", code, create: true }, undefined, owner)).json()).toMatchObject({ status: "created" });
  });

  it("keeps the owner's code when a stranger asks for one too, in either order, and spends neither by the stranger's tries", async () => {
    const owner = "203.0.113.5";
    const stranger = "198.51.100.7";
    for (const strangerFirst of [true, false]) {
      const { call, lastCode } = setup();
      const ask = async (client: string) => (await call("POST", "/code", { email: "me@example.com" }, undefined, client), lastCode());
      const first = await ask(strangerFirst ? stranger : owner);
      const second = await ask(strangerFirst ? owner : stranger);
      const ownerCode = strangerFirst ? second : first;
      const wrong = [first, second].includes("000000") ? ([first, second].includes("000001") ? "000002" : "000001") : "000000";
      // The stranger who asked is the asker of their own code: their 4 wrong tries spend only that one.
      for (let i = 0; i < 4; i++) expect((await call("POST", "/verify", { email: "me@example.com", code: wrong }, undefined, stranger)).status).toBe(400);
      expect(await (await call("POST", "/verify", { email: "me@example.com", code: ownerCode, create: true }, undefined, owner)).json()).toMatchObject({ status: "created" });
    }
  });

  it("keeps the code an address asked for from a network it signed in from, however many strangers ask after it", async () => {
    const { call, lastCode, inbox } = setup();
    const owner = "203.0.113.5";
    await call("POST", "/code", { email: "me@example.com" }, undefined, owner);
    await call("POST", "/verify", { email: "me@example.com", code: lastCode(), create: true }, undefined, owner);
    inbox.clear();
    await call("POST", "/code", { email: "me@example.com" }, undefined, owner);
    const ownerCode = lastCode();
    for (const client of ["198.51.100.7", "192.0.2.9", "198.18.0.1"]) await call("POST", "/code", { email: "me@example.com" }, undefined, client);
    expect(inbox.mails()).toHaveLength(4);
    expect(await (await call("POST", "/verify", { email: "me@example.com", code: ownerCode }, undefined, owner)).json()).toMatchObject({ status: "signed-in" });
  });

  it("spends a code after five wrong tries from everyone together", async () => {
    const { call, lastCode } = setup();
    await call("POST", "/code", { email: "me@example.com" }, undefined, "203.0.113.5");
    const code = lastCode();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 3; i++) await call("POST", "/verify", { email: "me@example.com", code: wrong }, undefined, "198.51.100.7");
    for (let i = 0; i < 2; i++) await call("POST", "/verify", { email: "me@example.com", code: wrong }, undefined, "203.0.113.5");
    expect((await call("POST", "/verify", { email: "me@example.com", code, create: true }, undefined, "203.0.113.5")).status).toBe(400);
  });

  it("lets a code expire after ten minutes, and a new code replaces the old one", async () => {
    const { call, lastCode, clock } = setup();
    await call("POST", "/code", { email: "me@example.com" });
    const first = lastCode();
    clock.now += CODE_TTL_MS;
    expect((await call("POST", "/verify", { email: "me@example.com", code: first, create: true })).status).toBe(400);
    await call("POST", "/code", { email: "me@example.com" });
    const second = lastCode();
    await call("POST", "/code", { email: "me@example.com" });
    if (second !== lastCode()) expect((await call("POST", "/verify", { email: "me@example.com", code: second, create: true })).status).toBe(400);
    expect((await call("POST", "/verify", { email: "me@example.com", code: lastCode(), create: true })).status).toBe(200);
  });

  it("sends one address at most 3 codes in 15 minutes and 5 a day per network, and 10 a day from strangers together", async () => {
    const { call, clock, inbox } = setup();
    for (let i = 0; i < 3; i++) expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(202);
    const refused = await call("POST", "/code", { email: "me@example.com" });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBe(900);
    expect((await call("POST", "/code", { email: "other@example.com" })).status).toBe(202);
    clock.now += 15 * 60_000;
    for (let i = 0; i < 2; i++) expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(202);
    clock.now += 15 * 60_000;
    expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(429);
    // Another network has its own share, and strangers together get 10 a day to one address.
    inbox.clear();
    for (let i = 0; i < 3; i++) expect((await call("POST", "/code", { email: "me@example.com" }, undefined, "203.0.1.7")).status).toBe(202);
    for (let i = 0; i < 2; i++) expect((await call("POST", "/code", { email: "me@example.com" }, undefined, "203.0.2.7")).status).toBe(202);
    // 5 + 3 + 2 = 10.
    expect((await call("POST", "/code", { email: "me@example.com" }, undefined, "203.0.3.7")).status).toBe(429);
    expect(inbox.mails().filter((mail) => mail.to === "me@example.com")).toHaveLength(5);
  });

  it("keeps a stranger's code requests from locking the owner out (sign-in from a known network, change of address, delete)", async () => {
    const { call, clock, inbox, signIn, lastCode } = setup();
    const token = await signIn("owner@example.com");
    clock.now += 15 * 60_000;
    // A stranger asks for the owner's address 10 times over the day: after 5 their network is refused.
    const answers: number[] = [];
    for (let i = 0; i < 10; i++) {
      answers.push((await call("POST", "/code", { email: "owner@example.com" }, undefined, "198.51.100.66")).status);
      clock.now += 16 * 60_000;
    }
    expect(answers).toEqual([202, 202, 202, 202, 202, 429, 429, 429, 429, 429]);
    // The owner, on a network they never signed in from, still gets a code and signs in; that network is theirs now.
    inbox.clear();
    expect((await call("POST", "/code", { email: "owner@example.com" }, undefined, "192.0.2.10")).status).toBe(202);
    expect(await (await call("POST", "/verify", { email: "owner@example.com", code: lastCode() }, undefined, "192.0.2.10")).json()).toMatchObject({ status: "signed-in" });
    // Strangers on three more networks fill the 10 a day strangers get (the owner's two codes from networks the address had not signed in from count too) ...
    for (let network = 1; network <= 3; network++) {
      for (let i = 0; i < 5; i++) {
        clock.now += 5 * 60_000;
        await call("POST", "/code", { email: "owner@example.com" }, undefined, `2001:db8:${network}:1::/64`);
      }
    }
    expect((await call("POST", "/code", { email: "owner@example.com" }, undefined, "203.0.113.9")).status).toBe(429);
    expect(inbox.mails().filter((mail) => mail.to === "owner@example.com")).toHaveLength(4);
    // ... but the networks the owner signed in from still get codes,
    expect((await call("POST", "/code", { email: "owner@example.com" }, undefined, "192.0.2.10")).status).toBe(202);
    expect(await (await call("POST", "/verify", { email: "owner@example.com", code: lastCode() }, undefined, "192.0.2.10")).json()).toMatchObject({ status: "signed-in" });
    expect((await call("POST", "/code", { email: "owner@example.com" })).status).toBe(202);
    // and what the owner asks for from inside the account is counted apart: changing the address and deleting still work.
    inbox.clear();
    expect((await call("POST", "/email/code", { email: "new-owner@example.com", confirmCurrent: true }, token)).status).toBe(202);
    expect(inbox.mails().map((mail) => mail.to).sort()).toEqual(["new-owner@example.com", "owner@example.com"]);
    expect((await call("POST", "/delete/code", {}, token)).status).toBe(202);
  });

  it("refuses what is not an address or not JSON, and says when mail fails", async () => {
    const { call, app } = setup();
    expect((await call("POST", "/code", { email: "not an address" })).status).toBe(400);
    expect((await call("POST", "/verify", { email: "me@example.com", code: "12345" })).status).toBe(400);
    const form = await app.request("http://tavora.test/v1/account/code", { method: "POST", body: "email=me@example.com" });
    expect(form.status).toBe(415);
    const failing = setup({ mailer: { send: () => Promise.reject(new Error("down")) } });
    expect(await (await failing.call("POST", "/code", { email: "me@example.com" })).json()).toMatchObject({ reason: "mail-failed" });
  });
});

describe("signed in", () => {
  it("shows the account and its devices, and refuses without a valid token", async () => {
    const { call, signIn } = setup();
    const first = await signIn("me@example.com", "windows");
    const second = await signIn("me@example.com", "toaster");
    const answer = (await (await call("GET", "", undefined, second)).json()) as { account: unknown; devices: { os: string; current: boolean }[] };
    expect(answer.account).toEqual({ email: "me@example.com", discord: null, createdAt: "2026-10-16T12:00:00.000Z" });
    expect(answer.devices.map(({ os, current }) => ({ os, current }))).toEqual([
      { os: "windows", current: false },
      { os: "other", current: true },
    ]);
    expect(JSON.stringify(answer)).not.toContain(first);
    expect((await call("GET", "")).status).toBe(401);
    expect((await call("GET", "", undefined, "x".repeat(43))).status).toBe(401);
  });

  it("signs out this device or another one", async () => {
    const { call, signIn } = setup();
    const first = await signIn("me@example.com");
    const second = await signIn("me@example.com");
    const devices = ((await (await call("GET", "", undefined, second)).json()) as { devices: { id: string; current: boolean }[] }).devices;
    const other = devices.find((device) => !device.current)!;
    expect((await call("DELETE", `/devices/${other.id}`, undefined, second)).status).toBe(204);
    expect((await call("GET", "", undefined, first)).status).toBe(401);
    expect((await call("POST", "/sign-out", {}, second)).status).toBe(204);
    expect((await call("GET", "", undefined, second)).status).toBe(401);
  });

  it("names devices from the sign-in, renames them, and never another account's", async () => {
    const { call, signIn } = setup();
    const mine = await signIn("me@example.com", "windows", "  DOMS-PC\u0007  ");
    await signIn("me@example.com", "windows");
    const theirs = await signIn("them@example.com");
    const list = async (token: string) => ((await (await call("GET", "", undefined, token)).json()) as { devices: { id: string; name: string | null }[] }).devices;
    const [first, second] = await list(mine);
    expect([first!.name, second!.name]).toEqual(["DOMS-PC", null]);
    expect((await call("PUT", `/devices/${second!.id}/name`, { name: "Laptop ".repeat(10) }, mine)).status).toBe(204);
    expect((await list(mine))[1]!.name).toBe("Laptop ".repeat(10).slice(0, 40).trim());
    expect((await call("PUT", `/devices/${second!.id}/name`, { name: "   " }, mine)).status).toBe(400);
    expect((await call("PUT", `/devices/${second!.id}/name`, { name: "Mine now" }, theirs)).status).toBe(404);
  });

  it("cannot sign out another account's device", async () => {
    const { call, signIn } = setup();
    const mine = await signIn("me@example.com");
    const theirs = await signIn("them@example.com");
    const theirDevice = ((await (await call("GET", "", undefined, theirs)).json()) as { devices: { id: string }[] }).devices[0];
    expect((await call("DELETE", `/devices/${theirDevice!.id}`, undefined, mine)).status).toBe(404);
    expect((await call("GET", "", undefined, theirs)).status).toBe(200);
  });

  it("ends a sign-in unused for a year", async () => {
    const { call, signIn, clock } = setup();
    const token = await signIn("me@example.com");
    clock.now += SESSION_IDLE_MS - 1;
    expect((await call("GET", "", undefined, token)).status).toBe(200);
    clock.now += SESSION_IDLE_MS;
    expect((await call("GET", "", undefined, token)).status).toBe(401);
  });

  /** The code in the newest mail to an address. */
  const codeTo = (inbox: ReturnType<typeof createTestInbox>, email: string) => /\n {4}(\d{6})\n/.exec(inbox.mails().find((mail) => mail.to === email)?.text ?? "")?.[1] ?? "";
  const other = (code: string) => (code === "000000" ? "000001" : "000000");

  it("changes the email only with codes to the new and the current address, signs the other devices out and tells the old one", async () => {
    const { call, signIn, inbox, clock } = setup();
    const token = await signIn("old@example.com");
    const laptop = await signIn("old@example.com");
    clock.now += 15 * 60_000;
    expect(await (await call("POST", "/email/code", { email: "old@example.com", confirmCurrent: true }, token)).json()).toMatchObject({ reason: "same-email" });
    const sent = await call("POST", "/email/code", { email: "new@example.com", confirmCurrent: true, language: "de" }, token);
    expect(sent.status).toBe(202);
    expect(await sent.json()).toEqual({ status: "sent", current: "email" });
    const [newCode, currentCode] = [codeTo(inbox, "new@example.com"), codeTo(inbox, "old@example.com")];
    expect(inbox.mails().find((mail) => mail.to === "old@example.com")).toMatchObject({ subject: "Bestätige die Änderung deiner E-Mail bei Tavora" });
    expect(inbox.mails().find((mail) => mail.to === "old@example.com")!.text).toContain("n•••@example.com");
    // Each code is checked on its own, and a wrong one says which.
    expect(await (await call("POST", "/email", { email: "new@example.com", code: newCode, currentCode: other(currentCode) }, token)).json()).toMatchObject({ reason: "wrong-current-code" });
    expect(await (await call("POST", "/email", { email: "new@example.com", code: other(newCode), currentCode }, token)).json()).toMatchObject({ reason: "wrong-code" });
    const changed = (await (await call("POST", "/email", { email: "new@example.com", code: newCode, currentCode }, token)).json()) as { token: string };
    expect(changed).toMatchObject({ account: { email: "new@example.com" }, token: expect.any(String), device: expect.any(String) });
    expect(inbox.mails()[0]).toMatchObject({ to: "old@example.com", subject: "The email of your Tavora account was changed" });
    expect(inbox.mails()[0]!.text).toContain("n•••@example.com");
    // Every sign-in ends, this one too: the device that changed it goes on with the new token in the answer, so a copy of
    // the old one is no use (audit 2026-11-22).
    expect((await (await call("GET", "", undefined, changed.token)).json()) as unknown).toMatchObject({ account: { email: "new@example.com" }, devices: [{ current: true, os: "windows" }] });
    expect((await call("GET", "", undefined, token)).status).toBe(401);
    expect((await call("GET", "", undefined, laptop)).status).toBe(401);
  });

  it("refuses an app that proves only the new address, before any mail goes out", async () => {
    const { call, signIn, inbox, clock } = setup();
    const token = await signIn("old@example.com");
    clock.now += 15 * 60_000;
    const mails = inbox.mails().length;
    const refused = await call("POST", "/email/code", { email: "new@example.com", language: "de" }, token);
    expect(refused.status).toBe(400);
    // An older Tavora shows the service's own sentence for "invalid".
    expect(await refused.json()).toMatchObject({ reason: "invalid", error: "Aktualisiere Tavora, um deine E-Mail zu ändern." });
    expect(inbox.mails()).toHaveLength(mails);
    await call("POST", "/email/code", { email: "new@example.com", confirmCurrent: true }, token);
    const newCode = codeTo(inbox, "new@example.com");
    expect(await (await call("POST", "/email", { email: "new@example.com", code: newCode }, token)).json()).toMatchObject({ reason: "invalid", error: "Update Tavora to change your email." });
    expect((await (await call("GET", "", undefined, token)).json()) as unknown).toMatchObject({ account: { email: "old@example.com" } });
  });

  it("takes the current address's code only for the new address it was sent for", async () => {
    const { call, signIn, inbox, clock } = setup();
    const token = await signIn("old@example.com");
    clock.now += 15 * 60_000;
    // A stolen sign-in asks for its own address first; the owner then asks for theirs and gets the newest current code.
    await call("POST", "/email/code", { email: "theirs@example.com", confirmCurrent: true }, token);
    const theirCode = codeTo(inbox, "theirs@example.com");
    await call("POST", "/email/code", { email: "mine@example.com", confirmCurrent: true }, token);
    const currentCode = codeTo(inbox, "old@example.com");
    expect(await (await call("POST", "/email", { email: "theirs@example.com", code: theirCode, currentCode }, token)).json()).toMatchObject({ reason: "wrong-current-code" });
    expect((await call("POST", "/email", { email: "mine@example.com", code: codeTo(inbox, "mine@example.com"), currentCode }, token)).status).toBe(200);
  });

  it("drops the codes still waiting for the old address once it changed", async () => {
    const { call, signIn, inbox, clock } = setup();
    const token = await signIn("old@example.com");
    clock.now += 15 * 60_000;
    await call("POST", "/delete/code", {}, token);
    const deleteCode = codeTo(inbox, "old@example.com");
    await call("POST", "/email/code", { email: "new@example.com", confirmCurrent: true }, token);
    const currentCode = codeTo(inbox, "old@example.com");
    await call("POST", "/code", { email: "old@example.com" });
    const signInCode = codeTo(inbox, "old@example.com");
    const changed = await call("POST", "/email", { email: "new@example.com", code: codeTo(inbox, "new@example.com"), currentCode }, token);
    expect(changed.status).toBe(200);
    const renewed = ((await changed.json()) as { token: string }).token;
    expect(await (await call("POST", "/delete", { code: deleteCode }, renewed)).json()).toMatchObject({ reason: "wrong-code" });
    expect(await (await call("POST", "/verify", { email: "old@example.com", code: signInCode, create: true })).json()).toMatchObject({ reason: "wrong-code" });
  });

  it("asks for nothing it can't send: both addresses' limits and the change's three emails come first", async () => {
    const { call, signIn, inbox, clock, store } = setup({ mailDailyLimit: 30 });
    const token = await signIn("old@example.com");
    clock.now += 15 * 60_000;
    for (let i = 0; i < 3; i++) await call("POST", "/code", { email: "new@example.com" });
    const mails = inbox.mails().length;
    expect((await call("POST", "/email/code", { email: "new@example.com", confirmCurrent: true }, token)).status).toBe(429);
    expect(inbox.mails()).toHaveLength(mails);
    // 30 a day: 10 for sign-in codes, 7 of them for new addresses. Two left: not enough for both codes and the notice.
    clock.now += 15 * 60_000;
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 5) store.countMail(day);
    expect(await (await call("POST", "/email/code", { email: "new@example.com", confirmCurrent: true }, token)).json()).toMatchObject({ reason: "daily-limit" });
    expect(inbox.mails()).toHaveLength(mails);
  });

  it("says an address is taken only after both codes were right", async () => {
    const { call, signIn, inbox } = setup();
    await signIn("taken@example.com");
    const token = await signIn("me@example.com");
    expect((await call("POST", "/email/code", { email: "taken@example.com", confirmCurrent: true }, token)).status).toBe(202);
    const [newCode, currentCode] = [codeTo(inbox, "taken@example.com"), codeTo(inbox, "me@example.com")];
    expect((await call("POST", "/email", { email: "taken@example.com", code: other(newCode), currentCode }, token)).status).toBe(400);
    expect((await call("POST", "/email", { email: "taken@example.com", code: newCode, currentCode: other(currentCode) }, token)).status).toBe(400);
    expect(await (await call("POST", "/email", { email: "taken@example.com", code: newCode, currentCode }, token)).json()).toMatchObject({ reason: "email-taken" });
  });

  it("does not take a sign-in code as a change or delete code", async () => {
    const { call, signIn, lastCode, clock } = setup();
    const token = await signIn("me@example.com");
    clock.now += 15 * 60_000;
    await call("POST", "/code", { email: "other@example.com" });
    const newCode = lastCode();
    await call("POST", "/code", { email: "me@example.com" });
    expect((await call("POST", "/email", { email: "other@example.com", code: newCode, currentCode: lastCode() }, token)).status).toBe(400);
    expect((await call("POST", "/delete", { code: lastCode() }, token)).status).toBe(400);
  });

  it("deletes the account with a fresh code, ending every sign-in", async () => {
    const { call, signIn, lastCode, store, inbox, clock } = setup();
    const token = await signIn("me@example.com");
    const other = await signIn("me@example.com");
    await call("POST", "/delete/code", { language: "de" }, token);
    expect(inbox.mails()[0]).toMatchObject({ to: "me@example.com", subject: "Bestätige das Löschen deines Tavora-Kontos" });
    expect((await call("POST", "/delete", { code: lastCode() }, token)).status).toBe(204);
    expect(store.accountByEmail("me@example.com")).toBeNull();
    expect((await call("GET", "", undefined, token)).status).toBe(401);
    expect((await call("GET", "", undefined, other)).status).toBe(401);
    // The address can start again (once its codes for every purpose are out of the 15-minute limit).
    clock.now += 15 * 60_000;
    expect(await (await call("POST", "/code", { email: "me@example.com" })).json()).toEqual({ status: "sent" });
  });
});

describe("email addresses", () => {
  it.each([
    ["Me.Name+tag@Example.COM", "me.name+tag@example.com"],
    ["  a@b.de ", "a@b.de"],
    ["no-at.example.com", null],
    ["two@@example.com", null],
    ["a@b", null],
    ["<a@b.de>", null],
    [42, null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it("masks an address in the change notice", () => {
    expect(maskEmail("alex@example.com")).toBe("a•••@example.com");
  });
});

describe("test inbox page", () => {
  it("shows mail as text, never as markup", async () => {
    const inbox = createTestInbox();
    await inbox.send({ to: "a@b.de", subject: "<script>alert(1)</script>", text: "hi" });
    const page = await (await createTestInboxApp(inbox).request("http://inbox.test/")).text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&#60;script&#62;");
    expect(await (await createTestInboxApp(inbox).request("http://inbox.test/mails")).json()).toMatchObject({ mails: [{ to: "a@b.de" }] });
  });
});

describe("profile", () => {
  const picture = Buffer.from(encodePng(256, 256, new Uint8Array(256 * 256 * 4).fill(200))).toString("base64");
  const profile = (updatedAt: string, extra: Record<string, unknown> = {}) => ({ name: "Alex", initials: "AX", picture: null, updatedAt, ...extra });

  it("starts empty, keeps what is sent, and keeps the newer of two", async () => {
    const { call, signIn } = setup();
    const token = await signIn("me@example.com");
    expect(await (await call("GET", "/profile", undefined, token)).json()).toEqual({ profile: null });
    const put = await call("PUT", "/profile", profile("2026-10-16T10:00:00.000Z", { picture }), token);
    expect(await put.json()).toEqual({ profile: { name: "Alex", initials: "AX", picture, updatedAt: "2026-10-16T10:00:00.000Z" } });
    // An older change (a PC that was offline) loses, and the answer says what the account has.
    const older = await call("PUT", "/profile", profile("2026-10-16T09:00:00.000Z", { name: "Old" }), token);
    expect(await older.json()).toMatchObject({ profile: { name: "Alex", picture } });
    await call("PUT", "/profile", profile("2026-10-16T11:00:00.000Z", { name: "Sam", picture: null }), token);
    expect(await (await call("GET", "/profile", undefined, token)).json()).toMatchObject({ profile: { name: "Sam", picture: null } });
  });

  it("never takes a time later than now", async () => {
    const { call, signIn } = setup();
    const token = await signIn("me@example.com");
    expect(await (await call("PUT", "/profile", profile("2030-01-01T00:00:00.000Z"), token)).json()).toMatchObject({ profile: { updatedAt: "2026-10-16T12:00:00.000Z" } });
  });

  it.each([
    ["a long name", { name: "x".repeat(33) }],
    ["a line break", { name: "a\nb" }],
    ["four initials", { initials: "ABCD" }],
    ["no time", { updatedAt: "yesterday" }],
    ["not a PNG", { picture: Buffer.from("<svg/>").toString("base64") }],
    ["the wrong size", { picture: Buffer.from(encodePng(64, 64, new Uint8Array(64 * 64 * 4))).toString("base64") }],
  ])("refuses %s", async (_label, extra) => {
    const { call, signIn } = setup();
    const token = await signIn("me@example.com");
    expect((await call("PUT", "/profile", profile("2026-10-16T10:00:00.000Z", extra), token)).status).toBe(400);
  });

  it("is only the owner's, and goes with the account", async () => {
    const { call, signIn, lastCode, clock } = setup();
    const mine = await signIn("me@example.com");
    const theirs = await signIn("them@example.com");
    await call("PUT", "/profile", profile("2026-10-16T10:00:00.000Z"), mine);
    expect(await (await call("GET", "/profile", undefined, theirs)).json()).toEqual({ profile: null });
    expect((await call("GET", "/profile")).status).toBe(401);
    await call("POST", "/delete/code", {}, mine);
    await call("POST", "/delete", { code: lastCode() }, mine);
    clock.now += 15 * 60_000;
    const again = await signIn("me@example.com");
    expect(await (await call("GET", "/profile", undefined, again)).json()).toEqual({ profile: null });
  });
});

describe("the day's emails", () => {
  it("keeps a share of the sign-in emails for accounts, stops sign-ins when only the reserved ones are left, and keeps those for changes and deletes", async () => {
    // 26 a day: 20 reserved, 6 for sign-in codes, of which 2 only for addresses with an account made before today.
    const { call, oldAccount, signIn, inbox, clock, pauses } = setup({ mailDailyLimit: 26 });
    const token = oldAccount("me@example.com");
    await signIn("today@example.com");
    for (let i = 0; i < 3; i++) expect((await call("POST", "/code", { email: `p${i}@example.com` })).status).toBe(202);
    // 4 sent: a new address, and an account made today, hear the same as an older account, after about as long, but get no mail.
    for (const email of ["late@example.com", "today@example.com"]) {
      const quiet = await call("POST", "/code", { email });
      expect([quiet.status, await quiet.json()]).toEqual([202, { status: "sent" }]);
      expect(inbox.mails()[0]?.to).not.toBe(email);
    }
    expect(pauses).toHaveLength(2);
    for (let i = 0; i < 2; i++) expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(202);
    expect(inbox.mails().filter((mail) => mail.to === "me@example.com")).toHaveLength(2);
    // 6 sent: nothing left for sign-ins, for anyone.
    for (const email of ["me@example.com", "late@example.com"]) {
      const refused = await call("POST", "/code", { email });
      expect(refused.status).toBe(503);
      expect(await refused.json()).toMatchObject({ reason: "daily-limit", retryAt: "2026-10-17T00:00:00.000Z" });
    }
    expect((await call("POST", "/delete/code", {}, token)).status).toBe(202);
    // The next day (UTC) starts again.
    clock.now = Date.parse("2026-10-17T00:00:01Z");
    expect((await call("POST", "/code", { email: "late@example.com" })).status).toBe(202);
    expect(inbox.mails()[0]?.to).toBe("late@example.com");
  });

  it("lets one address draw at most 3 codes a day from the share kept for accounts, and tells the maintainer once a day it was needed", async () => {
    // 50 a day: 30 for sign-in codes, 10 of them kept for accounts; new addresses had their 20.
    const { call, oldAccount, inbox, clock, store } = setup({ mailDailyLimit: 50 });
    oldAccount("me@example.com");
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 20) store.countMail(day);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 4; i++) {
        expect((await call("POST", "/code", { email: "me@example.com" }, undefined, `203.0.113.${i}`)).status).toBe(202);
        clock.now += 15 * 60_000;
      }
      expect(inbox.mails().filter((mail) => mail.to === "me@example.com")).toHaveLength(3);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/MAIL_DAILY_LIMIT/);
    } finally {
      warn.mockRestore();
    }
    expect(store.newAddressMailFullAt(day)).toBe(Date.parse("2026-10-16T12:00:00Z"));
  });

  it("keeps the owner's 3 from the share kept for accounts when strangers used up theirs (audit)", async () => {
    // As the audit planned it: 50 a day, new addresses had their 20; the owner signed in from 10.0.0.0/24 before.
    const { call, oldAccount, inbox, clock, store, pauses } = setup({ mailDailyLimit: 50 });
    oldAccount("victim@example.com");
    store.rememberNetwork("victim@example.com", "10.0.0.0/24", clock.now);
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 20) store.countMail(day);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const toVictim = () => inbox.mails().filter((mail) => mail.to === "victim@example.com").length;
    try {
      for (const client of ["198.51.100.7", "198.51.100.8", "203.0.113.9", "192.0.2.1"]) {
        expect(await (await call("POST", "/code", { email: "victim@example.com" }, undefined, client)).json()).toEqual({ status: "sent" });
        clock.now += 15 * 60_000;
      }
      // Strangers drew their 3; the fourth was answered alike, after a pause, with no mail.
      expect([toVictim(), pauses.length]).toEqual([3, 1]);
      // The owner, from a network they signed in from, still gets theirs.
      for (let i = 0; i < 3; i++) {
        expect((await call("POST", "/code", { email: "victim@example.com" }, undefined, "10.0.0.5")).status).toBe(202);
        clock.now += 15 * 60_000;
      }
      expect(toVictim()).toBe(6);
      expect(await (await call("POST", "/code", { email: "victim@example.com" }, undefined, "10.0.0.5")).json()).toEqual({ status: "sent" });
      expect([toVictim(), pauses.length]).toEqual([6, 2]);
    } finally {
      warn.mockRestore();
    }
  });

  it("counts a request its group of the address's limits refuses against neither share, and answers it alike", async () => {
    const { call, oldAccount, inbox, clock, store } = setup({ mailDailyLimit: 50 });
    oldAccount("me@example.com");
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 20) store.countMail(day);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A stranger network that had its 3 in 15 minutes is refused as always, and that uses nothing of the strangers' 3.
      for (let i = 0; i < 3; i++) store.countCodeRequest("me@example.com", clock.now, { from: "198.51.100.0/24" });
      for (let i = 0; i < 3; i++) expect((await call("POST", "/code", { email: "me@example.com" }, undefined, "198.51.100.7")).status).toBe(429);
      expect(inbox.mails()).toHaveLength(0);
      clock.now += 15 * 60_000;
      expect((await call("POST", "/code", { email: "me@example.com" }, undefined, "203.0.113.9")).status).toBe(202);
      expect(inbox.mails().filter((mail) => mail.to === "me@example.com")).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("answers without a mail after about as long as a send takes, and a failed send then like those", async () => {
    const sent: string[] = [];
    const flaky: Mailer = {
      send: async (mail) => {
        if (mail.to === "broken@example.com") throw new Error("down");
        sent.push(mail.to);
      },
    };
    const { call, oldAccount, store, clock, pauses } = setup({ mailer: flaky, mailDailyLimit: 26, sendMs: 400, accounts: { random: () => 0.5 } });
    oldAccount("broken@example.com");
    // Before the share runs out, a failed send is said as before, for any address.
    expect(await (await call("POST", "/code", { email: "broken@example.com" })).json()).toMatchObject({ reason: "mail-failed" });
    for (let i = 0; i < 4; i++) await call("POST", "/code", { email: `p${i}@example.com` });
    expect(store.mailsSent(new Date(clock.now).toISOString().slice(0, 10))).toBe(4);
    expect(pauses).toEqual([]);
    // 500 ms to start with, then 4 sends of 400 ms, each weighing a fifth: 441 ms (random 0.5 adds nothing).
    expect(await (await call("POST", "/code", { email: "late@example.com" })).json()).toEqual({ status: "sent" });
    expect(pauses).toEqual([441]);
    // Now a known address whose mail fails is answered like an address that gets none.
    const failed = await call("POST", "/code", { email: "broken@example.com" }, undefined, "192.0.2.1");
    expect([failed.status, await failed.json()]).toEqual([202, { status: "sent" }]);
  });

  it("holds the day's emails when many codes are asked for at once (hunt M2)", async () => {
    const sent: string[] = [];
    // Each send takes a moment, so all the requests are inside one before any comes back.
    const slow: Mailer = { send: async (mail) => void (await new Promise((resolve) => setTimeout(resolve, 5)), sent.push(mail.to)) };
    // 26 a day: 6 for sign-in codes, 4 of them for new addresses.
    const { call, store, clock } = setup({ mailer: slow, mailDailyLimit: 26 });
    const answers = await Promise.all(Array.from({ length: 30 }, (_, n) => call("POST", "/code", { email: `p${n}@example.com` }, undefined, `203.0.${n}.1`)));
    expect(answers.map((answer) => answer.status)).toEqual(Array.from({ length: 30 }, () => 202));
    expect(sent).toHaveLength(4);
    expect(store.mailsSent(new Date(clock.now).toISOString().slice(0, 10))).toBe(4);
  });

  it("gives a failed send's email back to the day", async () => {
    const flaky: Mailer = {
      send: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("down");
      },
    };
    const { call, store, clock } = setup({ mailer: flaky, mailDailyLimit: 26 });
    const answers = await Promise.all(Array.from({ length: 3 }, (_, n) => call("POST", "/code", { email: `p${n}@example.com` }, undefined, `203.0.${n}.1`)));
    expect(answers.map((answer) => answer.status)).toEqual([502, 502, 502]);
    expect(store.mailsSent(new Date(clock.now).toISOString().slice(0, 10))).toBe(0);
  });

  it("keeps every pause within its bounds", async () => {
    // 50 a day: new addresses get 20; sends that take a minute count as 3 s.
    const { call, store, clock, pauses } = setup({ mailDailyLimit: 50, sendMs: 60_000, accounts: { random: () => 1, codeDayRateLimiter: roomy(), codeNetworkRateLimiter: roomy() } });
    for (let i = 0; i < 20; i++) await call("POST", "/code", { email: `p${i}@example.com` });
    expect(store.mailsSent(new Date(clock.now).toISOString().slice(0, 10))).toBe(20);
    await call("POST", "/code", { email: "late@example.com" });
    expect(pauses).toEqual([3000]);
  });

  it("keeps sign-in codes for an existing account when 28 clients ask 10 times each for made-up addresses (audit)", async () => {
    // As the audit tried it (28 IPv6 /64s of one /48), and worse: 28 /64s in 28 different /48s.
    for (const [oneNetwork, layout] of [
      [true, (n: number) => `2001:db8:1:${n}::/64`],
      [false, (n: number) => `2001:db8:${n}:1::/64`],
    ] as const) {
      const { call, oldAccount, inbox, store, clock, pauses } = setup({ mailDailyLimit: 300, accounts: { codeRateLimiter: createRateLimiter({ limit: 10, windowMs: 3_600_000 }) } });
      oldAccount("victim@example.com");
      const day = new Date(clock.now).toISOString().slice(0, 10);
      const answers = new Map<number, number>();
      for (let n = 1; n <= 28; n++) {
        for (let i = 0; i < 10; i++) {
          const status = (await call("POST", "/code", { email: `a${n}-${i}@attacker.example` }, undefined, layout(n))).status;
          answers.set(status, (answers.get(status) ?? 0) + 1);
        }
        clock.now += 10_000;
      }
      if (oneNetwork) {
        // One network: 40 a day between all its clients.
        expect(Object.fromEntries(answers)).toEqual({ 202: 40, 429: 240 });
        expect(store.mailsSent(day)).toBe(40);
      } else {
        // Every request answered alike, but new addresses stop getting mail once 187 went out (300 - 20 - 93).
        expect(Object.fromEntries(answers)).toEqual({ 202: 280 });
        expect(store.mailsSent(day)).toBe(187);
        expect(pauses).toHaveLength(280 - 187);
      }
      inbox.clear();
      expect((await call("POST", "/code", { email: "victim@example.com" }, undefined, "192.0.2.44")).status).toBe(202);
      expect(inbox.mails()[0]?.to).toBe("victim@example.com");
    }
  });

  it("keeps the day's emails when 30 accounts ask for their own codes all day (audit)", async () => {
    // As the audit planned it: 30 accounts, each from its own /64, asking for delete and Discord codes every 15 minutes.
    // Worse than one /48: 30 different /48s, so only each account's own share holds them.
    for (const [oneNetwork, layout] of [
      [true, (n: number) => `2001:db8:1:${n}::/64`],
      [false, (n: number) => `2001:db8:${n}:1::/64`],
    ] as const) {
      const { call, oldAccount, inbox, store, clock } = setup({ mailDailyLimit: 300, accounts: { codeRateLimiter: createRateLimiter({ limit: 10, windowMs: 3_600_000 }) } });
      oldAccount("victim@example.com");
      const day = new Date(clock.now).toISOString().slice(0, 10);
      const tokens = Array.from({ length: 30 }, (_, n) => oldAccount(`a${n}@attacker.example`));
      for (let round = 0; round < 10; round++) {
        for (const [n, token] of tokens.entries()) {
          for (const path of ["/delete/code", "/discord/code", "/delete/code"]) await call("POST", path, {}, token, layout(n + 1));
        }
        clock.now += 15 * 60_000;
      }
      // At most 5 an account, and 40 a network.
      expect(store.mailsSent(day)).toBe(oneNetwork ? 40 : 150);
      inbox.clear();
      expect((await call("POST", "/code", { email: "victim@example.com" }, undefined, "192.0.2.44")).status).toBe(202);
      expect(inbox.mails()[0]?.to).toBe("victim@example.com");
    }
  });

  it("stops owners' codes with the sign-in codes, and keeps the reserved emails for one delete code an account a day", async () => {
    // 50 a day: 30 for sign-in codes, 20 reserved.
    const { call, oldAccount, store, clock, inbox } = setup({ mailDailyLimit: 50 });
    const tokens = Array.from({ length: 22 }, (_, n) => oldAccount(`a${n}@example.com`));
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 30) store.countMail(day);
    // Connecting Discord no longer has room ...
    expect(await (await call("POST", "/discord/code", {}, tokens[0], "198.51.100.1")).json()).toMatchObject({ reason: "daily-limit" });
    // ... deleting has, once a day per account.
    expect((await call("POST", "/delete/code", {}, tokens[0], "198.51.100.1")).status).toBe(202);
    clock.now += 15 * 60_000;
    expect(await (await call("POST", "/delete/code", {}, tokens[0], "198.51.100.1")).json()).toMatchObject({ reason: "daily-limit" });
    // Each account once: 20 reserved, so the 21st account finds none left.
    for (let n = 1; n < 20; n++) expect((await call("POST", "/delete/code", {}, tokens[n], `198.51.${n}.1`)).status).toBe(202);
    expect(store.mailsSent(day)).toBe(50);
    expect(inbox.mails()).toHaveLength(20);
    expect(await (await call("POST", "/delete/code", {}, tokens[20], "203.0.113.1")).json()).toMatchObject({ reason: "daily-limit" });
  });

  it("keeps the reserved emails from accounts made today and from one network's many accounts (review)", async () => {
    // 50 a day: 30 for sign-in codes, 20 reserved.
    const { call, oldAccount, signIn, store, clock } = setup({ mailDailyLimit: 50 });
    const today = await signIn("today@example.com");
    const tokens = Array.from({ length: 5 }, (_, n) => oldAccount(`a${n}@example.com`));
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 30) store.countMail(day);
    // An account made today gets no delete code from them.
    expect(await (await call("POST", "/delete/code", {}, today, "203.0.113.1")).json()).toMatchObject({ reason: "daily-limit" });
    // Two a network, whichever accounts ask.
    for (const [n, token] of tokens.entries()) {
      const answer = await call("POST", "/delete/code", {}, token, `2001:db8:1:${n}::/64`);
      expect(answer.status).toBe(n < 2 ? 202 : 503);
    }
    expect(store.mailsSent(day)).toBe(32);
    // Another network has its own two; the third account's refusal above didn't use its own one up.
    expect((await call("POST", "/delete/code", {}, tokens[2], "198.51.100.9")).status).toBe(202);
  });

  it("sends a suspended account's delete code within the same shares and reserve, and answers like any other address", async () => {
    const { call, oldAccount, store, clock, inbox, pauses } = setup({ mailDailyLimit: 50, accounts: { codeDayRateLimiter: createRateLimiter({ limit: 2, windowMs: 24 * 60 * 60_000 }) } });
    oldAccount("held@example.com");
    oldAccount("held2@example.com");
    for (const email of ["held@example.com", "held2@example.com"]) store.suspend(store.accountByEmail(email)!.id, "spam", null, clock.now);
    // The client's day share holds for every address alike.
    for (const email of ["nobody@example.com", "held@example.com"]) expect((await call("POST", "/delete/suspended/code", { email }, undefined, "203.0.113.1")).status).toBe(202);
    expect((await call("POST", "/delete/suspended/code", { email: "held@example.com" }, undefined, "203.0.113.1")).status).toBe(429);
    expect(inbox.mails().map((mail) => mail.to)).toEqual(["held@example.com"]);
    // Once sign-in codes ran out: one from the reserve for the account, then answered like an address without one.
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 30) store.countMail(day);
    clock.now += 15 * 60_000;
    expect((await call("POST", "/delete/suspended/code", { email: "held2@example.com" }, undefined, "198.51.100.1")).status).toBe(202);
    expect(inbox.mails()).toHaveLength(2);
    clock.now += 15 * 60_000;
    const before = pauses.length;
    expect(await (await call("POST", "/delete/suspended/code", { email: "held2@example.com" }, undefined, "198.51.100.2")).json()).toEqual({ status: "sent" });
    expect([inbox.mails().length, pauses.length]).toEqual([2, before + 1]);
  });

  it("counts an owner's code against none of the shares when one of them refuses (review)", async () => {
    const { call, oldAccount, inbox } = setup({ accounts: { codeNetworkRateLimiter: createRateLimiter({ limit: 1, windowMs: 24 * 60 * 60_000 }) } });
    const token = oldAccount("me@example.com");
    // Another client used the network's share: the refusal leaves the account's 5 alone.
    expect((await call("POST", "/code", { email: "someone@example.com" }, undefined, "198.51.100.1")).status).toBe(202);
    for (let i = 0; i < 6; i++) expect((await call("POST", "/delete/code", {}, token, "198.51.100.2")).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await call("POST", "/delete/code", {}, token, `203.0.${i}.1`)).status).toBe(202);
    expect(inbox.mails().filter((mail) => mail.to === "me@example.com")).toHaveLength(3);
  });

  it("counts an owner's code against the account's 5 only when the address's own limit lets it go (hunt M1)", async () => {
    const { call, oldAccount, inbox, clock } = setup();
    const token = oldAccount("me@example.com");
    // 3 codes in 15 minutes to the address: the 4th and 5th press are refused, and use nothing up.
    const presses = [];
    for (let i = 0; i < 5; i++) presses.push((await call("POST", "/delete/code", {}, token)).status);
    expect(presses).toEqual([202, 202, 202, 429, 429]);
    // A while later the owner still has 2 of their 5 for the day.
    clock.now += 16 * 60_000;
    for (const path of ["/delete/code", "/discord/code"]) expect((await call("POST", path, {}, token)).status).toBe(202);
    clock.now += 16 * 60_000;
    expect((await call("POST", "/delete/code", {}, token)).status).toBe(429);
    expect(inbox.mails().filter((mail) => mail.to === "me@example.com")).toHaveLength(5);
  });

  it("spends no reserved email on a delete code the address's own limit refuses (hunt M1)", async () => {
    // 50 a day: 30 for sign-in codes, 20 reserved.
    const { call, oldAccount, store, clock } = setup({ mailDailyLimit: 50 });
    const token = oldAccount("me@example.com");
    for (let i = 0; i < 3; i++) expect((await call("POST", "/delete/code", {}, token)).status).toBe(202);
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 30) store.countMail(day);
    expect((await call("POST", "/delete/code", {}, token)).status).toBe(429);
    expect(store.mailsSent(day)).toBe(30);
    clock.now += 16 * 60_000;
    expect((await call("POST", "/delete/code", {}, token)).status).toBe(202);
  });

  it("limits codes for a new address: 3 changes a day per account, the day's shares, and new addresses' emails only", async () => {
    const { call, oldAccount, store, clock } = setup({ mailDailyLimit: 50 });
    const token = oldAccount("me@example.com");
    for (let i = 0; i < 3; i++) {
      expect((await call("POST", "/email/code", { email: `next${i}@example.com`, confirmCurrent: true }, token)).status).toBe(202);
      clock.now += 15 * 60_000;
    }
    expect((await call("POST", "/email/code", { email: "next3@example.com", confirmCurrent: true }, token)).status).toBe(429);
    // Another account: a code to the new address comes out of new addresses' share (20 of 50), never out of the rest.
    const other = oldAccount("other@example.com");
    const day = new Date(clock.now).toISOString().slice(0, 10);
    while (store.mailsSent(day) < 19) store.countMail(day);
    expect(await (await call("POST", "/email/code", { email: "fresh@example.com", confirmCurrent: true }, other)).json()).toMatchObject({ reason: "daily-limit" });
    // Deleting still has the reserved emails.
    expect((await call("POST", "/delete/code", {}, other)).status).toBe(202);
  });

  it("counts each email of an address change against the client's day share of codes: both codes and the notice", async () => {
    const { call, oldAccount, inbox } = setup({ accounts: { codeDayRateLimiter: createRateLimiter({ limit: 5, windowMs: 24 * 60 * 60_000 }) } });
    const token = oldAccount("me@example.com");
    expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(202);
    expect((await call("POST", "/email/code", { email: "next@example.com", confirmCurrent: true }, token)).status).toBe(202);
    // 4 of 5 counted: another change, 3 more, doesn't fit, and sends nothing.
    const mails = inbox.mails().length;
    expect((await call("POST", "/email/code", { email: "other@example.com", confirmCurrent: true }, token)).status).toBe(429);
    expect(inbox.mails()).toHaveLength(mails);
    // The refusal counted nothing: one more sign-in code still fits.
    expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(202);
    expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(429);
  });

  it("says the same when the provider refuses because its allowance is used up", async () => {
    const { call } = setup({ mailer: { send: () => Promise.reject(new MailLimitError()) } });
    expect(await (await call("POST", "/code", { email: "me@example.com" })).json()).toMatchObject({ reason: "daily-limit" });
  });
});

describe("Brevo", () => {
  const mail = { to: "me@example.com", subject: "Your Tavora code", text: "123456" };

  it("sends plain text from Tavora's address with the key in a header", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const mailer = createBrevoMailer({ apiKey: "xkeysib-test", from: "signin@mytavora.app", fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response('{"messageId":"1"}', { status: 201 });
    }) as unknown as typeof fetch });
    await mailer.send(mail);
    expect(sent[0]!.url).toBe(BREVO_URL);
    expect(new Headers(sent[0]!.init.headers).get("api-key")).toBe("xkeysib-test");
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ sender: { name: "Tavora", email: "signin@mytavora.app" }, to: [{ email: "me@example.com" }], subject: "Your Tavora code", textContent: "123456" });
  });

  it("tells a used-up allowance apart from other failures, and never puts the key in the error", async () => {
    const answer = (status: number, body: string) =>
      createBrevoMailer({ apiKey: "xkeysib-secret", from: "signin@mytavora.app", fetch: (async () => new Response(body, { status })) as unknown as typeof fetch });
    await expect(answer(402, "{}").send(mail)).rejects.toBeInstanceOf(MailLimitError);
    await expect(answer(400, '{"code":"not_enough_credits","message":"Not enough credits"}').send(mail)).rejects.toBeInstanceOf(MailLimitError);
    // A short rate limit isn't the day's allowance.
    for (const [status, body] of [
      [429, '{"code":"too_many_requests","message":"Rate limit exceeded"}'],
      [400, '{"code":"invalid_parameter","message":"Subject is over the length limit"}'],
    ] as const) {
      const failed = answer(status, body).send(mail);
      await expect(failed).rejects.toThrow(`Brevo answered ${status}`);
      await expect(failed).rejects.not.toBeInstanceOf(MailLimitError);
    }
    const other = answer(401, '{"code":"unauthorized"}').send(mail);
    await expect(other).rejects.toThrow("Brevo answered 401");
    await expect(other).rejects.not.toThrow(/secret/);
  });
});

describe("Discord login", () => {
  const ALEX = { id: "123456789012345678", name: "alex" };
  const OTHER = { id: "223456789012345678", name: "other" };
  const VERIFIER = "v".repeat(43);
  /** A pretend Discord: each code stands for one Discord user; "bad" is refused. */
  const pretend = (users: Record<string, { id: string; name: string }>): DiscordClient => ({
    identify: async (code) => {
      const user = users[code];
      if (!user) throw new DiscordError("discord-refused");
      return user;
    },
  });
  const setupDiscord = () => {
    const context = setup({ discord: pretend({ codewellbrained: ALEX, codeother000: OTHER, codewellbrainedrenamed: { ...ALEX, name: "wellbrained2" } }) });
    /** Connects a Discord login as the app does: a code to the account's address, then a fresh Discord sign-in. */
    const connect = async (token: string, code: string) => {
      await context.call("POST", "/discord/code", {}, token);
      return context.call("POST", "/discord", { code, verifier: VERIFIER, emailCode: context.lastCode() }, token);
    };
    return { ...context, connect };
  };

  it("reads the account again once Discord answered, so a login changed meanwhile deletes nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowDiscord: DiscordClient = {
      identify: async () => {
        await gate;
        return ALEX;
      },
    };
    const { call, signIn, store } = setup({ discord: slowDiscord });
    const token = await signIn("me@example.com");
    const id = store.accountByEmail("me@example.com")!.id;
    store.setDiscord(id, ALEX);
    const deleting = call("POST", "/delete/discord", { code: "codewellbrained", verifier: VERIFIER }, token);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Another login takes its place while Discord still answers. (Removing it ends every sign-in, audit run 7.)
    expect(store.setDiscord(id, OTHER)).toBe("ok");
    release();
    expect(await (await deleting).json()).toMatchObject({ reason: "discord-mismatch" });
    expect(store.account(id)).not.toBeNull();
  });

  it("asks before creating a Discord-only account, then signs the same login in again", async () => {
    const { call } = setupDiscord();
    const first = (await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER, os: "windows" })).json()) as { status: string; ticket: string };
    expect(first).toMatchObject({ status: "no-account", discord: { name: "alex" } });
    const created = (await (await call("POST", "/discord/create", { ticket: first.ticket, os: "windows" })).json()) as Record<string, unknown>;
    expect(created).toMatchObject({ status: "created", account: { email: null, discord: { name: "alex" } } });
    // The ticket is spent.
    expect(await (await call("POST", "/discord/create", { ticket: first.ticket })).json()).toMatchObject({ reason: "discord-expired" });
    // Signing in again finds it, and a new username is picked up; the id is never shown.
    const again = (await (await call("POST", "/discord/sign-in", { code: "codewellbrainedrenamed", verifier: VERIFIER })).json()) as Record<string, unknown>;
    expect(again).toMatchObject({ status: "signed-in", account: { discord: { name: "wellbrained2" } } });
    expect(JSON.stringify(again)).not.toContain(ALEX.id);
  });

  it("caps new accounts a day by email and Discord together, keeping the code and the ticket for when there is room", async () => {
    const { call, signIn, lastCode, clock, store } = setup({ discord: pretend({ codewellbrained: ALEX, codeother000: OTHER }), accounts: { accountDailyLimit: 2 } });
    clock.now = Date.parse("2026-10-16T23:55:00Z");
    await signIn("one@example.com");
    const alex = (await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()) as { ticket: string };
    expect(await (await call("POST", "/discord/create", { ticket: alex.ticket })).json()).toMatchObject({ status: "created" });
    // Two made today: a third is refused, by email (only once its code was right) and by Discord.
    await call("POST", "/code", { email: "three@example.com" });
    const code = lastCode();
    expect(await (await call("POST", "/verify", { email: "three@example.com", code: code === "000000" ? "000001" : "000000", create: true })).json()).toMatchObject({ reason: "wrong-code" });
    const full = await call("POST", "/verify", { email: "three@example.com", code, create: true });
    expect([full.status, await full.json()]).toEqual([503, { error: "Tavora can't take more new accounts today. Try again tomorrow.", reason: "unavailable", retryAt: "2026-10-17T00:00:00.000Z" }]);
    const second = (await (await call("POST", "/discord/sign-in", { code: "codeother000", verifier: VERIFIER })).json()) as { ticket: string };
    expect(await (await call("POST", "/discord/create", { ticket: second.ticket })).json()).toMatchObject({ reason: "unavailable" });
    expect(store.accountByEmail("three@example.com")).toBeNull();
    expect(store.accountByDiscord(OTHER.id)).toBeNull();
    // Existing accounts still sign in.
    await call("POST", "/code", { email: "one@example.com" });
    expect(await (await call("POST", "/verify", { email: "one@example.com", code: lastCode() })).json()).toMatchObject({ status: "signed-in" });
    // A new day (UTC): the same code and ticket make the accounts.
    clock.now = Date.parse("2026-10-17T00:01:00Z");
    expect(await (await call("POST", "/verify", { email: "three@example.com", code, create: true })).json()).toMatchObject({ status: "created" });
    expect(await (await call("POST", "/discord/create", { ticket: second.ticket })).json()).toMatchObject({ status: "created" });
  });

  it("gives each network a share of the day's new accounts", async () => {
    const { call, lastCode, store } = setup({ accounts: { accountNetworkRateLimiter: createRateLimiter({ limit: 1, windowMs: 24 * 60 * 60_000 }) } });
    const create = async (email: string, client: string) => {
      await call("POST", "/code", { email }, undefined, client);
      return call("POST", "/verify", { email, code: lastCode(), create: true }, undefined, client);
    };
    expect((await create("a@example.com", "198.51.100.1")).status).toBe(200);
    const refused = await create("b@example.com", "198.51.100.2");
    expect([refused.status, ((await refused.json()) as { reason: string }).reason]).toEqual([429, "too-many"]);
    expect(store.accountByEmail("b@example.com")).toBeNull();
    expect((await create("c@example.com", "203.0.113.5")).status).toBe(200);
  });

  it("counts a network's share of new accounts only for a Discord ticket that holds, and keeps a refused ticket", async () => {
    const { call, store, clock } = setup({ discord: pretend({ codewellbrained: ALEX, codeother000: OTHER }), accounts: { accountNetworkRateLimiter: createRateLimiter({ limit: 1, windowMs: 24 * 60 * 60_000 }) } });
    // A made-up or expired ticket is refused before the share is counted.
    for (let i = 0; i < 3; i++) expect(await (await call("POST", "/discord/create", { ticket: "x".repeat(43) })).json()).toMatchObject({ reason: "discord-expired" });
    const alex = (await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()) as { ticket: string };
    expect(await (await call("POST", "/discord/create", { ticket: alex.ticket })).json()).toMatchObject({ status: "created" });
    // The network's share is used: the next login's ticket stays, and works from another network.
    const other = (await (await call("POST", "/discord/sign-in", { code: "codeother000", verifier: VERIFIER })).json()) as { ticket: string };
    expect(await (await call("POST", "/discord/create", { ticket: other.ticket })).json()).toMatchObject({ reason: "too-many" });
    expect(store.peekDiscord(other.ticket, clock.now)).toEqual(OTHER);
    expect(await (await call("POST", "/discord/create", { ticket: other.ticket }, undefined, "203.0.113.5")).json()).toMatchObject({ status: "created" });
  });

  it("lets a held Discord login expire after 10 minutes", async () => {
    const { call, clock } = setupDiscord();
    const { ticket } = (await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()) as { ticket: string };
    clock.now += 10 * 60_000;
    expect(await (await call("POST", "/discord/create", { ticket })).json()).toMatchObject({ reason: "discord-expired" });
  });

  it("connects Discord only from a signed-in account, never taking it from another, and never merges", async () => {
    const { call, signIn, store, connect } = setupDiscord();
    const mine = await signIn("me@example.com");
    const theirs = await signIn("them@example.com");
    expect(await (await connect(mine, "codewellbrained")).json()).toMatchObject({ account: { email: "me@example.com", discord: { name: "alex" } } });
    expect(await (await connect(theirs, "codewellbrained")).json()).toMatchObject({ reason: "discord-taken" });
    expect(store.accountByEmail("them@example.com")?.discord).toBeNull();
    // The Discord sign-in now reaches the email account.
    expect(await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()).toMatchObject({ status: "signed-in", account: { email: "me@example.com" } });
  });

  it("never removes the last way in, and removes a method only with a code sent to the account's address", async () => {
    const { call, signIn, lastCode, connect } = setupDiscord();
    const token = await signIn("me@example.com");
    expect(await (await call("POST", "/discord/remove/code", {}, token)).json()).toMatchObject({ reason: "no-discord" });
    expect(await (await call("POST", "/email/remove/code", {}, token)).json()).toMatchObject({ reason: "last-method" });
    await connect(token, "codewellbrained");
    // The session alone is not enough: the old one-step routes are gone, and a wrong code changes nothing.
    expect((await call("DELETE", "/email", undefined, token)).status).toBe(404);
    expect((await call("DELETE", "/discord", undefined, token)).status).toBe(404);
    expect((await call("POST", "/email/remove/code", {}, token)).status).toBe(202);
    const code = lastCode();
    expect(await (await call("POST", "/email/remove", { code: code === "000000" ? "000001" : "000000" }, token)).json()).toMatchObject({ reason: "wrong-code" });
    const removed = (await (await call("POST", "/email/remove", { code: lastCode() }, token)).json()) as { token: string };
    expect(removed).toMatchObject({ account: { email: null, discord: { name: "alex" } } });
    // Every sign-in ended with it; this one goes on with the new one (audit run 7).
    const renewed = removed.token;
    expect(await (await call("POST", "/discord/remove/code", {}, renewed)).json()).toMatchObject({ reason: "last-method" });
    expect(await (await call("POST", "/discord/remove", { code: "123456" }, renewed)).json()).toMatchObject({ reason: "last-method" });
    expect(await (await call("POST", "/email/remove/code", {}, renewed)).json()).toMatchObject({ reason: "no-email" });
  });

  it("ends every sign-in when a way in is removed, as an email change does, so one made through it stops working (audit run 7)", async () => {
    const { call, signIn, store, lastCode, connect, clock } = setupDiscord();
    const owner = await signIn("me@example.com");
    await connect(owner, "codewellbrained");
    const id = store.accountByEmail("me@example.com")!.id;
    // Someone else has the Discord login, signs in with it and makes something to publish with.
    const stolen = ((await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()) as { token: string }).token;
    const thief = store.sessionByToken(stolen, clock.now)!;
    store.createPublishToken(id, "theirs", clock.now, thief.id);
    // The owner takes the Discord login away.
    await call("POST", "/discord/remove/code", {}, owner);
    const removed = (await (await call("POST", "/discord/remove", { code: lastCode() }, owner)).json()) as { token: string; device: string };
    expect(removed).toMatchObject({ account: { email: "me@example.com", discord: null }, token: expect.any(String), device: expect.any(String) });
    expect((await call("GET", "", undefined, stolen)).status).toBe(401);
    expect((await call("GET", "", undefined, owner)).status).toBe(401);
    expect(store.publishTokens(id, clock.now)).toEqual([]);
    // The owner's device goes on with the new token from the answer.
    expect(await (await call("GET", "", undefined, removed.token)).json()).toMatchObject({ account: { email: "me@example.com" }, devices: [{ current: true }] });

    // The same for an address someone else could sign in with: removed through the Discord login, every sign-in ends.
    clock.now += 15 * 60_000;
    await connect(removed.token, "codewellbrained");
    const byMail = await signIn("me@example.com");
    clock.now += 15 * 60_000;
    expect(await (await call("POST", "/email/remove/code", {}, removed.token)).json()).toEqual({ status: "sent" });
    const mailGone = (await (await call("POST", "/email/remove", { code: lastCode() }, removed.token)).json()) as { token: string };
    expect(mailGone).toMatchObject({ account: { email: null, discord: { name: "alex" } }, token: expect.any(String) });
    expect((await call("GET", "", undefined, byMail)).status).toBe(401);
    expect((await call("GET", "", undefined, removed.token)).status).toBe(401);
    expect((await call("GET", "", undefined, mailGone.token)).status).toBe(200);
  });

  it("does not let a stolen sign-in add, swap or keep a Discord login without the mailbox (A6)", async () => {
    const { call, signIn, inbox, store, lastCode } = setupDiscord();
    const token = await signIn("me@example.com");
    inbox.clear();
    // Without the code from the account's mailbox, a session alone cannot connect a Discord login.
    expect(await (await call("POST", "/discord", { code: "codeother000", verifier: VERIFIER }, token)).json()).toMatchObject({ reason: "bad-request" });
    await call("POST", "/discord/code", {}, token);
    expect(inbox.mails()[0]).toMatchObject({ to: "me@example.com", subject: "Confirm connecting Discord to Tavora" });
    const sent = lastCode();
    expect(await (await call("POST", "/discord", { code: "codeother000", verifier: VERIFIER, emailCode: sent === "000000" ? "000001" : "000000" }, token)).json()).toMatchObject({ reason: "wrong-code" });
    expect(store.accountByDiscord(OTHER.id)).toBeNull();
    // With it, the owner connects; another Discord login never replaces the connected one.
    expect(await (await call("POST", "/discord", { code: "codewellbrained", verifier: VERIFIER, emailCode: sent }, token)).json()).toMatchObject({ account: { discord: { name: "alex" } } });
    expect(await (await call("POST", "/discord/code", {}, token)).json()).toMatchObject({ reason: "discord-connected" });
    expect(await (await call("POST", "/discord", { code: "codeother000", verifier: VERIFIER, emailCode: "123456" }, token)).json()).toMatchObject({ reason: "discord-connected" });
    // Disconnecting needs a code to the address, not the Discord login itself: the owner can always remove one
    // they lost or one someone else connected, and a session alone cannot.
    await call("POST", "/discord/remove/code", {}, token);
    expect(inbox.mails()[0]).toMatchObject({ to: "me@example.com", subject: "Confirm disconnecting Discord from Tavora" });
    const removal = lastCode();
    expect(await (await call("POST", "/discord/remove", { code: removal === "000000" ? "000001" : "000000" }, token)).json()).toMatchObject({ reason: "wrong-code" });
    expect(store.accountByDiscord(ALEX.id)?.email).toBe("me@example.com");
    expect(await (await call("POST", "/discord/remove", { code: removal }, token)).json()).toMatchObject({ account: { email: "me@example.com", discord: null } });
  });

  it("does not connect Discord on a day without mail, when no code can reach the owner", async () => {
    const { call, signIn, store, clock } = setup({ discord: pretend({ codewellbrained: ALEX }), mailDailyLimit: 21 });
    const token = await signIn("me@example.com");
    // The rest of the day's allowance goes to other users.
    for (let i = 0; i < 20; i++) store.countMail(new Date(clock.now).toISOString().slice(0, 10));
    expect(await (await call("POST", "/discord/code", {}, token)).json()).toMatchObject({ reason: "daily-limit" });
  });

  it("adds an email to a Discord-only account with a code and a fresh Discord sign-in, and sends no change notice to a missing address", async () => {
    const { call, inbox, lastCode } = setupDiscord();
    const { ticket } = (await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()) as { ticket: string };
    const { token } = (await (await call("POST", "/discord/create", { ticket })).json()) as { token: string };
    const laptop = ((await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()) as { token: string }).token;
    expect(await (await call("POST", "/email/code", { email: "me@example.com", confirmCurrent: true }, token)).json()).toEqual({ status: "sent", current: "discord" });
    expect(inbox.mails()).toHaveLength(1);
    const code = lastCode();
    expect(await (await call("POST", "/email", { email: "me@example.com", code }, token)).json()).toMatchObject({ reason: "invalid" });
    expect(await (await call("POST", "/email", { email: "me@example.com", code, discord: { code: "codeother000", verifier: VERIFIER } }, token)).json()).toMatchObject({ reason: "discord-mismatch" });
    const changed = (await (await call("POST", "/email", { email: "me@example.com", code, discord: { code: "codewellbrained", verifier: VERIFIER } }, token)).json()) as { token: string };
    expect(changed).toMatchObject({ account: { email: "me@example.com", discord: { name: "alex" } } });
    expect(inbox.mails()).toHaveLength(1);
    expect((await call("GET", "", undefined, laptop)).status).toBe(401);
    expect((await call("GET", "", undefined, token)).status).toBe(401);
    expect((await call("GET", "", undefined, changed.token)).status).toBe(200);
  });

  it("deletes a Discord-only account by a fresh Discord sign-in with its own login", async () => {
    const { call, store } = setupDiscord();
    const { ticket } = (await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()) as { ticket: string };
    const { token } = (await (await call("POST", "/discord/create", { ticket })).json()) as { token: string };
    expect(await (await call("POST", "/delete/code", {}, token)).json()).toMatchObject({ reason: "no-email" });
    expect(await (await call("POST", "/delete/discord", { code: "codeother000", verifier: VERIFIER }, token)).json()).toMatchObject({ reason: "discord-mismatch" });
    expect((await call("POST", "/delete/discord", { code: "codewellbrained", verifier: VERIFIER }, token)).status).toBe(204);
    expect(store.accountByDiscord(ALEX.id)).toBeNull();
    expect((await call("GET", "", undefined, token)).status).toBe(401);
  });

  it("refuses what is not a Discord code or verifier, says when Discord refuses, and is off without a client", async () => {
    const { call } = setupDiscord();
    expect((await call("POST", "/discord/sign-in", { code: "x", verifier: VERIFIER })).status).toBe(400);
    expect((await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: "short" })).status).toBe(400);
    expect(await (await call("POST", "/discord/sign-in", { code: "unknowncode1", verifier: VERIFIER })).json()).toMatchObject({ reason: "discord-refused" });
    const off = setup();
    expect(await (await off.call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()).toMatchObject({ reason: "unavailable" });
  });
});

describe("Discord client", () => {
  const VERIFIER = "v".repeat(43);

  it("exchanges the code without a secret, reads only id and username, and revokes the token", async () => {
    const calls: { url: string; body: string; auth: string | null }[] = [];
    const client = createDiscordClient({
      api: "https://discord.test/api",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body ?? ""), auth: new Headers(init.headers).get("authorization") });
        if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "tok", scope: "identify" });
        if (url.endsWith("/users/@me")) return Response.json({ id: "123456789012345678", username: "alex\u202e", email: "never@example.com" });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await client.identify("codewellbrained", VERIFIER)).toEqual({ id: "123456789012345678", name: "alex" });
    expect(calls.map((call) => call.url)).toEqual(["https://discord.test/api/oauth2/token", "https://discord.test/api/users/@me", "https://discord.test/api/oauth2/token/revoke"]);
    const exchange = new URLSearchParams(calls[0]!.body);
    expect(Object.fromEntries(exchange)).toEqual({ client_id: "1560388687370387610", grant_type: "authorization_code", code: "codewellbrained", redirect_uri: "http://127.0.0.1:53682/discord", code_verifier: VERIFIER });
    expect(calls[1]!.auth).toBe("Bearer tok");
    expect(new URLSearchParams(calls[2]!.body).get("token")).toBe("tok");
  });

  it("tells a refusal from an outage, and refuses a user without a proper id", async () => {
    const answering = (token: Response, me?: Response) =>
      createDiscordClient({ fetch: (async (url: string) => (url.endsWith("/oauth2/token") ? token : (me ?? new Response(null)))) as unknown as typeof fetch });
    await expect(answering(new Response("{}", { status: 400 })).identify("codewellbrained", VERIFIER)).rejects.toMatchObject({ reason: "discord-refused" });
    await expect(answering(new Response("{}", { status: 503 })).identify("codewellbrained", VERIFIER)).rejects.toMatchObject({ reason: "discord-unreachable" });
    await expect(answering(Response.json({ access_token: "t" }), Response.json({ id: "abc", username: "x" })).identify("codewellbrained", VERIFIER)).rejects.toMatchObject({ reason: "discord-refused" });
    const offline = createDiscordClient({ fetch: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch });
    await expect(offline.identify("codewellbrained", VERIFIER)).rejects.toMatchObject({ reason: "discord-unreachable" });
  });

  it("keeps a username as plain text of at most 32 characters", () => {
    expect(cleanDiscordName("a\u0000b\u202ec")).toBe("abc");
    expect(cleanDiscordName("x".repeat(40))).toHaveLength(32);
    expect(cleanDiscordName("  ")).toBeNull();
  });
});
describe("emails that follow a request (audit)", () => {
  const codeTo = (inbox: ReturnType<typeof createTestInbox>, email: string) => /\n {4}(\d{6})\n/.exec(inbox.mails().find((mail) => mail.to === email)?.text ?? "")?.[1] ?? "";
  const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
  /** A key fingerprint for account `n`'s key `k`: 32 hex digits. */
  const fingerprint = (n: number, k: number) => `${n.toString(16).padStart(16, "0")}${k.toString(16).padStart(16, "0")}`;
  /** Old accounts with 5 linked keys each, and their tokens. */
  const developers = (context: ReturnType<typeof setup>, count: number, prefix: string) =>
    Array.from({ length: count }, (_, n) => {
      const email = `${prefix}${n}@attacker.example`;
      const token = context.oldAccount(email);
      const id = context.store.accountByEmail(email)!.id;
      const keys = Array.from({ length: 5 }, (_, k) => fingerprint(n, k));
      for (const key of keys) context.store.linkKey(id, key, "AAAA", context.clock.now);
      return { email, token, id, keys };
    });
  /** Each account asks for k0 -> k1, k1 -> k2, k2 -> k3 and k3 -> k4, chained: 4 notices if nothing held them. */
  const chain = async (context: ReturnType<typeof setup>, developer: ReturnType<typeof developers>[number], client: string) => {
    const answers: number[] = [];
    for (let k = 0; k < 4; k++) {
      answers.push((await context.call("POST", `/keys/${developer.keys[k]}/replace`, { new: developer.keys[k + 1], leaked: false }, developer.token, client)).status);
    }
    return answers;
  };
  const adminKeys = (store: AccountStore) => store.allKeyRequests();

  it("counts key replacement notices in the client's day share, 3 an account a day, and keeps every request (audit)", async () => {
    // As the audit planned it, with two more accounts: 50 a day (30 for sign-ins), every request from one client.
    const context = setup({ mailDailyLimit: 50 });
    const { call, store, clock, inbox, oldAccount } = context;
    oldAccount("victim@example.com");
    const client = "198.51.100.7";
    const accounts = developers(context, 8, "a");
    const answers = [];
    for (const developer of accounts) answers.push(await chain(context, developer, client));
    // 3 requests an account a day, each told, until the client's 20 were used: then this client's requests are refused
    // rather than left untold, and nothing is stored for them.
    expect(answers).toEqual([...Array(6).fill([200, 200, 200, 429]), [200, 200, 429, 429], [429, 429, 429, 429]]);
    const to = (email: string) => inbox.mails().filter((mail) => mail.to === email).length;
    expect([to("a0@attacker.example"), to("a6@attacker.example"), to("a7@attacker.example")]).toEqual([3, 2, 0]);
    expect(store.mailsSent(utcDay(clock.now))).toBe(20);
    expect(adminKeys(store).every((request) => request.notified === true)).toBe(true);
    expect(store.keyRequests(accounts[7]!.id)).toHaveLength(0);
    // A leaked key is always reported, also then: it goes in, noted as untold.
    expect((await call("POST", `/keys/${accounts[7]!.keys[0]}/replace`, { new: accounts[7]!.keys[1], leaked: true }, accounts[7]!.token, client)).status).toBe(200);
    expect(store.keyRequest(accounts[7]!.keys[0]!)).toMatchObject({ leaked: true, notified: false });
    // The client's share is spent for its codes as well; everyone else still signs in.
    expect((await call("POST", "/code", { email: "a0@attacker.example" }, undefined, client)).status).toBe(429);
    expect((await call("POST", "/code", { email: "victim@example.com" }, undefined, "203.0.113.9")).status).toBe(202);
    expect(inbox.mails()[0]?.to).toBe("victim@example.com");
  });

  it("counts key replacement notices in the network's day share, whichever of its clients asks (audit)", async () => {
    const context = setup({ mailDailyLimit: 100 });
    const { call, store, clock, oldAccount } = context;
    oldAccount("victim@example.com");
    // 15 accounts, each from its own /64 of one /48: 45 notices if only the accounts' own limits held them. The network's
    // share is others' too, so it never stops a request: past it, they go in untold, and the review page says so.
    for (const [n, developer] of developers(context, 15, "b").entries()) {
      expect(await chain(context, developer, `2001:db8:1:${n}::/64`)).toEqual([200, 200, 200, 429]);
    }
    expect(store.mailsSent(utcDay(clock.now))).toBe(40);
    const requests = adminKeys(store);
    expect([requests.length, requests.filter((request) => request.notified === false).length]).toEqual([45, 5]);
    expect((await call("POST", "/code", { email: "victim@example.com" }, undefined, "203.0.113.9")).status).toBe(202);
  });

  it("counts the three emails of an address change in the client's day share (audit)", async () => {
    // As the audit planned it: 3 accounts change their address 3 times each from one client, 15 minutes apart.
    const { call, oldAccount, store, clock, inbox } = setup({ mailDailyLimit: 300 });
    const client = "198.51.100.7";
    const current = ["e0@example.com", "e1@example.com", "e2@example.com"];
    const tokens = current.map((email) => oldAccount(email));
    const answers: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (const [n, token] of tokens.entries()) {
        const next = `e${n}-${round}@example.test`;
        const asked = await call("POST", "/email/code", { email: next, confirmCurrent: true, language: "en" }, token, client);
        answers.push(asked.status);
        if (asked.status !== 202) continue;
        const changed = await call("POST", "/email", { email: next, code: codeTo(inbox, next), currentCode: codeTo(inbox, current[n]!) }, token, client);
        expect(changed.status).toBe(200);
        tokens[n] = ((await changed.json()) as { token: string }).token;
        current[n] = next;
      }
      clock.now += 15 * 60_000;
    }
    // 3 emails a change, each counted: 6 changes fit in the client's 20, and the rest is refused before any mail.
    expect(answers).toEqual([202, 202, 202, 202, 202, 202, 429, 429, 429]);
    expect(store.mailsSent(utcDay(clock.now))).toBe(18);
  });

  it("leaves out the change notice once the day's sign-in emails ran out, keeping the reserve for delete codes (audit)", async () => {
    // As the audit planned it: 50 a day, 30 for sign-ins; 5 changes asked for, then the sign-in emails run out.
    const { call, oldAccount, store, clock, inbox } = setup({ mailDailyLimit: 50 });
    const day = utcDay(clock.now);
    const accounts = Array.from({ length: 5 }, (_, n) => ({ email: `c${n}@example.com`, next: `f${n}@example.test`, token: oldAccount(`c${n}@example.com`) }));
    for (const { next, token } of accounts) expect((await call("POST", "/email/code", { email: next, confirmCurrent: true }, token, "198.51.100.7")).status).toBe(202);
    expect(store.mailsSent(day)).toBe(10);
    while (store.mailsSent(day) < 30) store.countMail(day);
    for (const { email, next, token } of accounts) {
      expect((await call("POST", "/email", { email: next, code: codeTo(inbox, next), currentCode: codeTo(inbox, email) }, token, "198.51.100.7")).status).toBe(200);
    }
    expect(store.mailsSent(day)).toBe(30);
    expect(inbox.mails().filter((mail) => mail.subject === "The email of your Tavora account was changed")).toHaveLength(0);
    // Every delete code still has its reserve.
    for (let n = 0; n < 2; n++) expect((await call("POST", "/delete/code", {}, oldAccount(`owner${n}@example.com`), `203.0.${n}.1`)).status).toBe(202);
  });

  it("answers repeated delete codes for a suspended account like those for any other address (audit)", async () => {
    // As the audit planned it: 4 requests in 15 minutes for one address from one network.
    const { call, oldAccount, store, clock, inbox, pauses } = setup({ mailDailyLimit: 50 });
    oldAccount("s@example.com");
    oldAccount("n@example.com");
    store.suspend(store.accountByEmail("s@example.com")!.id, "spam", null, clock.now);
    const ask = async (email: string, client: string, paths = ["/delete/suspended/code", "/delete/suspended/code", "/delete/suspended/code", "/delete/suspended/code"]) => {
      const answers: [number, string | null][] = [];
      for (const path of paths) {
        const answer = await call("POST", path, { email }, undefined, client);
        answers.push([answer.status, answer.headers.get("retry-after")]);
      }
      return answers;
    };
    const suspended = await ask("s@example.com", "198.51.100.7");
    expect(suspended).toEqual([
      [202, null],
      [202, null],
      [202, null],
      [429, "900"],
    ]);
    expect(await ask("n@example.com", "203.0.113.7")).toEqual(suspended);
    expect(await ask("nobody@example.com", "192.0.2.7")).toEqual(suspended);
    expect(inbox.mails().map((mail) => mail.to)).toEqual(["s@example.com", "s@example.com", "s@example.com"]);
    // Those without a mail waited about as long as a send.
    expect(pauses).toHaveLength(6);
    // Across routes: one delete code, then sign-in codes, from a fresh network.
    const mixed = ["/delete/suspended/code", "/code", "/code", "/code"];
    clock.now += 15 * 60_000;
    const across = await ask("s@example.com", "100.64.1.7", mixed);
    expect(across.map(([status]) => status)).toEqual([202, 202, 202, 429]);
    expect(await ask("n@example.com", "100.64.2.7", mixed)).toEqual(across);
  });

  it("answers a suspended account's delete code whose mail failed like any other address (audit)", async () => {
    const flaky: Mailer = {
      send: async () => {
        throw new Error("down");
      },
    };
    const { call, oldAccount, store, clock } = setup({ mailer: flaky });
    oldAccount("s@example.com");
    store.suspend(store.accountByEmail("s@example.com")!.id, "spam", null, clock.now);
    for (const email of ["s@example.com", "nobody@example.com"]) {
      const answer = await call("POST", "/delete/suspended/code", { email });
      expect([answer.status, await answer.json()]).toEqual([202, { status: "sent" }]);
    }
  });
});
