import { describe, expect, it } from "vitest";
import { AccountStore, CODE_TTL_MS, normalizeEmail, SESSION_IDLE_MS } from "./account-store.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { BREVO_URL, createBrevoMailer, createTestInbox, createTestInboxApp, MailLimitError, maskEmail, type Mailer } from "./mail.ts";
import { encodePng } from "./png.ts";
import { createRateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

function setup(options: { mailer?: Mailer; mailDailyLimit?: number } = {}) {
  const store = new AccountStore(":memory:");
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-16T12:00:00Z") };
  const app = createApp({
    db,
    rateLimiter: roomy(),
    accounts: { store, mailer: options.mailer ?? inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => clock.now, ...(options.mailDailyLimit === undefined ? {} : { mailDailyLimit: options.mailDailyLimit }) },
  });
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test/v1/account${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const lastCode = () => /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
  /** Signs an address in, creating its account when needed, and returns the token. */
  const signIn = async (email: string, os = "windows") => {
    await call("POST", "/code", { email });
    const answer = (await (await call("POST", "/verify", { email, code: lastCode(), os, create: true })).json()) as { token: string };
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
    expect(answer.account).toEqual({ email: "me@example.com", createdAt: "2026-10-16T12:00:00.000Z" });
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
    expect(maskEmail("nik@example.com")).toBe("n•••@example.com");
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
  const profile = (updatedAt: string, extra: Record<string, unknown> = {}) => ({ name: "Nik", initials: "NK", picture: null, updatedAt, ...extra });

  it("starts empty, keeps what is sent, and keeps the newer of two", async () => {
    const { call, signIn } = setup();
    const token = await signIn("me@example.com");
    expect(await (await call("GET", "/profile", undefined, token)).json()).toEqual({ profile: null });
    const put = await call("PUT", "/profile", profile("2026-10-16T10:00:00.000Z", { picture }), token);
    expect(await put.json()).toEqual({ profile: { name: "Nik", initials: "NK", picture, updatedAt: "2026-10-16T10:00:00.000Z" } });
    // An older change (a PC that was offline) loses, and the answer says what the account has.
    const older = await call("PUT", "/profile", profile("2026-10-16T09:00:00.000Z", { name: "Old" }), token);
    expect(await older.json()).toMatchObject({ profile: { name: "Nik", picture } });
    await call("PUT", "/profile", profile("2026-10-16T11:00:00.000Z", { name: "Dominik", picture: null }), token);
    expect(await (await call("GET", "/profile", undefined, token)).json()).toMatchObject({ profile: { name: "Dominik", picture: null } });
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