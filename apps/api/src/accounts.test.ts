import { describe, expect, it } from "vitest";
import { AccountStore, CODE_TTL_MS, normalizeEmail, SESSION_IDLE_MS } from "./account-store.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { BREVO_URL, createBrevoMailer, createTestInbox, createTestInboxApp, MailLimitError, maskEmail, type Mailer } from "./mail.ts";
import { cleanDiscordName, createDiscordClient, DiscordError, type DiscordClient } from "./discord.ts";
import { encodePng } from "./png.ts";
import { createRateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

function setup(options: { mailer?: Mailer; mailDailyLimit?: number; discord?: DiscordClient } = {}) {
  const store = new AccountStore(":memory:");
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-16T12:00:00Z") };
  const app = createApp({
    db,
    rateLimiter: roomy(),
    accounts: { store, mailer: options.mailer ?? inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => clock.now, ...(options.mailDailyLimit === undefined ? {} : { mailDailyLimit: options.mailDailyLimit }), ...(options.discord ? { discord: options.discord } : {}) },
  });
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test/v1/account${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const lastCode = () => /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
  /** Signs an address in, creating its account when needed, and returns the token. */
  const signIn = async (email: string, os = "windows", name?: string) => {
    await call("POST", "/code", { email });
    const answer = (await (await call("POST", "/verify", { email, code: lastCode(), os, create: true, ...(name === undefined ? {} : { name }) })).json()) as { token: string };
    return answer.token;
  };
  return { store, inbox, clock, app, call, lastCode, signIn };
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

  it("sends one address at most 3 codes in 15 minutes and 10 a day", async () => {
    const { call, clock } = setup();
    for (let i = 0; i < 3; i++) expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(202);
    const refused = await call("POST", "/code", { email: "me@example.com" });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBe(900);
    expect((await call("POST", "/code", { email: "other@example.com" })).status).toBe(202);
    for (let i = 0; i < 2; i++) {
      clock.now += 15 * 60_000;
      for (let j = 0; j < 3; j++) expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(202);
    }
    clock.now += 15 * 60_000;
    expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(202);
    expect((await call("POST", "/code", { email: "me@example.com" })).status).toBe(429);
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

  it("changes the email with a code to the new address and tells the old one", async () => {
    const { call, signIn, inbox, lastCode } = setup();
    const token = await signIn("old@example.com");
    expect(await (await call("POST", "/email/code", { email: "old@example.com" }, token)).json()).toMatchObject({ reason: "same-email" });
    await call("POST", "/email/code", { email: "new@example.com" }, token);
    expect(inbox.mails()[0]!.to).toBe("new@example.com");
    const changed = await call("POST", "/email", { email: "new@example.com", code: lastCode() }, token);
    expect(await changed.json()).toMatchObject({ account: { email: "new@example.com" } });
    expect(inbox.mails()[0]).toMatchObject({ to: "old@example.com", subject: "The email of your Tavora account was changed" });
    expect(inbox.mails()[0]!.text).toContain("n•••@example.com");
    expect((await (await call("GET", "", undefined, token)).json()) as unknown).toMatchObject({ account: { email: "new@example.com" } });
  });

  it("says an address is taken only after its code was right", async () => {
    const { call, signIn, lastCode } = setup();
    await signIn("taken@example.com");
    const token = await signIn("me@example.com");
    expect((await call("POST", "/email/code", { email: "taken@example.com" }, token)).status).toBe(202);
    expect((await call("POST", "/email", { email: "taken@example.com", code: "000000" === lastCode() ? "000001" : "000000" }, token)).status).toBe(400);
    expect(await (await call("POST", "/email", { email: "taken@example.com", code: lastCode() }, token)).json()).toMatchObject({ reason: "email-taken" });
  });

  it("does not take a sign-in code as a change or delete code", async () => {
    const { call, signIn, lastCode } = setup();
    const token = await signIn("me@example.com");
    await call("POST", "/code", { email: "other@example.com" });
    expect((await call("POST", "/email", { email: "other@example.com", code: lastCode() }, token)).status).toBe(400);
    await call("POST", "/code", { email: "me@example.com" });
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
  it("stops sign-ins when only the reserved emails are left, and keeps those for changes and deletes", async () => {
    const { call, signIn, inbox, clock } = setup({ mailDailyLimit: 23 });
    const token = await signIn("me@example.com");
    for (let i = 0; i < 2; i++) expect((await call("POST", "/code", { email: `p${i}@example.com` })).status).toBe(202);
    // 3 sent: 23 - 20 reserved = 3 for sign-ins.
    const refused = await call("POST", "/code", { email: "late@example.com" });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ reason: "daily-limit", retryAt: "2026-10-17T00:00:00.000Z" });
    expect(inbox.mails().some((mail) => mail.to === "late@example.com")).toBe(false);
    expect((await call("POST", "/delete/code", {}, token)).status).toBe(202);
    // The next day (UTC) starts again.
    clock.now = Date.parse("2026-10-17T00:00:01Z");
    expect((await call("POST", "/code", { email: "late@example.com" })).status).toBe(202);
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
    expect(await (await call("POST", "/email/remove", { code: lastCode() }, token)).json()).toMatchObject({ account: { email: null, discord: { name: "alex" } } });
    expect(await (await call("POST", "/discord/remove/code", {}, token)).json()).toMatchObject({ reason: "last-method" });
    expect(await (await call("POST", "/discord/remove", { code: "123456" }, token)).json()).toMatchObject({ reason: "last-method" });
    expect(await (await call("POST", "/email/remove/code", {}, token)).json()).toMatchObject({ reason: "no-email" });
  });

  it("does not let a stolen sign-in add, swap or keep a Discord login without the mailbox (A6)", async () => {
    const { call, signIn, inbox, store, lastCode, connect } = setupDiscord();
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

  it("adds an email to a Discord-only account with a code, and sends no change notice to a missing address", async () => {
    const { call, inbox, lastCode } = setupDiscord();
    const { ticket } = (await (await call("POST", "/discord/sign-in", { code: "codewellbrained", verifier: VERIFIER })).json()) as { ticket: string };
    const { token } = (await (await call("POST", "/discord/create", { ticket })).json()) as { token: string };
    await call("POST", "/email/code", { email: "me@example.com" }, token);
    expect(await (await call("POST", "/email", { email: "me@example.com", code: lastCode() }, token)).json()).toMatchObject({ account: { email: "me@example.com", discord: { name: "alex" } } });
    expect(inbox.mails()).toHaveLength(1);
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