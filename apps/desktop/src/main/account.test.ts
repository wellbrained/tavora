import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AccountView } from "../shared/host-api";
import { AccountClient, deviceOs, loadAccount, saveAccount, type ProfileData, type SavedAccount } from "./account";
import type { Encryptor } from "./discord-store";
import { PlayerError } from "./messages";

// Stands in for safeStorage: reversible, and never the plain text.
const encryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  decrypt: (data) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
});

const TOKEN = "t".repeat(43);
const SAVED: SavedAccount = { token: TOKEN, email: "me@example.com", discord: null, createdAt: "2026-10-16T12:00:00.000Z" };
const DEVICE = { id: "dev1", os: "windows", createdAt: SAVED.createdAt, lastUsedAt: SAVED.createdAt, current: true };

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
  auth: string | null;
}

/** A pretend service: answers by "METHOD path", records every call. */
function service(answers: Record<string, (body: Record<string, unknown> | undefined) => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const key = `${method} ${url.replace("https://api.test/v1/account", "") || "/"}`;
    // The profile read at every start, unless a test asks about it: none, and not recorded.
    if (key === "GET /profile" && !answers[key]) return json({ profile: null });
    calls.push({ method, url, body, auth: new Headers(init?.headers).get("authorization") });
    const answer = answers[key];
    return answer ? answer(body) : json({ error: "Not found." }, 404);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const EMPTY_PROFILE: ProfileData = { name: "", initials: "", picture: null, updatedAt: null };

function client(fetchImpl: typeof fetch, options: { saved?: SavedAccount | null; enabled?: boolean; canKeep?: boolean; profile?: ProfileData; discordLogin?: () => Promise<{ code: string; verifier: string }> } = {}) {
  const views: AccountView[] = [];
  const kept: (SavedAccount | null)[] = [];
  /** This PC's profile, and every profile the account put in its place. */
  const local = { profile: options.profile ?? EMPTY_PROFILE, applied: [] as ProfileData[] };
  const account = new AccountClient({
    enabled: options.enabled ?? true,
    baseUrl: "https://api.test/",
    fetch: fetchImpl,
    os: "windows",
    language: () => "de",
    canKeepSignIn: () => options.canKeep ?? true,
    load: async () => options.saved ?? null,
    save: async (value) => void kept.push(value),
    onChange: (view) => views.push(view),
    ...(options.discordLogin ? { discordLogin: options.discordLogin } : {}),
    profile: {
      get: async () => local.profile,
      apply: async (profile) => {
        local.profile = profile;
        local.applied.push(profile);
      },
    },
  });
  return { account, views, kept, local };
}

const signedInAnswer = (status: "signed-in" | "created") => () =>
  json({ status, token: TOKEN, device: "dev1", account: { email: "me@example.com", createdAt: SAVED.createdAt } });

describe("signing in", () => {
  it("sends a code, then signs an existing account in and reads its devices", async () => {
    const { calls, fetchImpl } = service({
      "POST /code": () => json({ status: "sent" }, 202),
      "POST /verify": signedInAnswer("signed-in"),
      "GET /": () => json({ account: { email: "me@example.com", createdAt: SAVED.createdAt }, devices: [DEVICE, { id: 5 }] }),
      "GET /profile": () => json({ profile: null }),
    });
    const { account, kept } = client(fetchImpl);
    await account.init();
    await account.sendCode("  me@example.com ");
    expect(account.view().pending).toEqual({ kind: "sign-in", email: "me@example.com", step: "code" });
    await account.verify("123456");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://api.test/v1/account/code",
      "POST https://api.test/v1/account/verify",
      "GET https://api.test/v1/account",
      "GET https://api.test/v1/account/profile",
    ]);
    expect(calls[0]!.body).toEqual({ email: "me@example.com", language: "de" });
    expect(calls[1]!.body).toEqual({ email: "me@example.com", code: "123456", os: "windows" });
    expect(calls[2]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(kept).toEqual([SAVED]);
    // The token never reaches the host UI; a malformed device is dropped.
    const view = account.view();
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(view).toEqual({ enabled: true, canKeepSignIn: true, account: { email: "me@example.com", discord: null, createdAt: SAVED.createdAt }, discordLogin: false, devices: [DEVICE], pending: null, profileChoice: null });
  });

  it("asks before creating an account for a new address, then creates it with the same code", async () => {
    const { calls, fetchImpl } = service({
      "POST /code": () => json({ status: "sent" }, 202),
      "POST /verify": (body) => (body?.create ? signedInAnswer("created")() : json({ status: "no-account" })),
      "GET /": () => json({ account: { email: "me@example.com" }, devices: [] }),
    });
    const { account } = client(fetchImpl);
    await account.sendCode("me@example.com");
    await account.verify("654321");
    expect(account.view().pending).toEqual({ kind: "sign-in", email: "me@example.com", step: "create" });
    expect(account.view().account).toBeNull();
    // Not without the age confirmation, and nothing is sent then.
    await expect(account.create(false)).rejects.toMatchObject({ key: "account.error.ageRequired" });
    expect(calls).toHaveLength(2);
    await account.create(true);
    expect(calls[2]!.body).toEqual({ email: "me@example.com", code: "654321", os: "windows", create: true });
    expect(account.view().account?.email).toBe("me@example.com");
  });

  it("turns the service's reasons into messages, with the wait for too many tries", async () => {
    const { fetchImpl } = service({
      "POST /code": () => json({ reason: "too-many" }, 429, { "retry-after": "900" }),
      "POST /verify": () => json({ reason: "wrong-code" }, 400),
    });
    const { account } = client(fetchImpl);
    await expect(account.sendCode("me@example.com")).rejects.toMatchObject({ key: "account.error.tooMany", params: { minutes: 15 } });
    await expect(account.verify("123456")).rejects.toMatchObject({ key: "account.error.noCode" });
    (account as unknown as { pending: unknown }).pending = { kind: "sign-in", email: "me@example.com", step: "code" };
    await expect(account.verify("123456")).rejects.toMatchObject({ key: "account.error.wrongCode" });
  });

  it("says when the service cannot be reached or accounts are off", async () => {
    const offline = client((async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    await expect(offline.account.sendCode("me@example.com")).rejects.toMatchObject({ key: "account.error.unreachable" });
    const off = client(service({ "POST /code": () => json({ reason: "unavailable" }, 503) }).fetchImpl);
    await expect(off.account.sendCode("me@example.com")).rejects.toBeInstanceOf(PlayerError);
    await expect(off.account.sendCode("me@example.com")).rejects.toMatchObject({ key: "account.error.unavailable" });
    // The day's emails are used up: when it works again, in the player's language.
    const full = client(service({ "POST /code": () => json({ reason: "daily-limit", retryAt: "2026-10-17T00:00:00.000Z" }, 503) }).fetchImpl);
    await expect(full.account.sendCode("me@example.com")).rejects.toMatchObject({ key: "account.error.dailyLimit" });
    const fullNoTime = client(service({ "POST /code": () => json({ reason: "daily-limit" }, 503) }).fetchImpl);
    await expect(fullNoTime.account.sendCode("me@example.com")).rejects.toMatchObject({ key: "account.error.dailyLimitSoon" });
    // A service from before accounts answers 404.
    const old = client(service({}).fetchImpl);
    await expect(old.account.sendCode("me@example.com")).rejects.toMatchObject({ key: "account.error.unavailable" });
  });

  it("does nothing while accounts are switched off", async () => {
    const { calls, fetchImpl } = service({});
    const { account } = client(fetchImpl, { enabled: false, saved: SAVED });
    await account.init();
    expect(account.view()).toMatchObject({ enabled: false, account: null });
    await expect(account.sendCode("me@example.com")).rejects.toMatchObject({ key: "error.notAllowed" });
    await account.refresh();
    expect(calls).toEqual([]);
  });

  it("keeps the sign-in only in memory where it cannot be encrypted", async () => {
    const { fetchImpl } = service({ "POST /code": () => json({}, 202), "POST /verify": signedInAnswer("signed-in"), "GET /": () => json({ devices: [] }) });
    const { account, kept } = client(fetchImpl, { canKeep: false });
    await account.sendCode("me@example.com");
    await account.verify("123456");
    expect(account.view()).toMatchObject({ canKeepSignIn: false, account: { email: "me@example.com" } });
    expect(kept).toEqual([]);
  });
});

describe("signed in", () => {
  it("forgets a sign-in the service no longer knows", async () => {
    const { fetchImpl } = service({ "GET /": () => json({ reason: "signed-out" }, 401) });
    const { account, kept } = client(fetchImpl, { saved: SAVED });
    await account.init();
    await expect(account.refresh()).rejects.toMatchObject({ key: "account.error.signedOut" });
    expect(account.view().account).toBeNull();
    expect(kept).toEqual([null]);
  });

  it("signs out on this PC even when the service cannot be reached", async () => {
    const { account, kept } = client((async () => {
      throw new TypeError("offline");
    }) as typeof fetch, { saved: SAVED });
    await account.init();
    await account.signOut();
    expect(account.view().account).toBeNull();
    expect(kept).toEqual([null]);
  });

  it("changes the email with a code to the new address", async () => {
    const { calls, fetchImpl } = service({
      "POST /email/code": () => json({ status: "sent" }, 202),
      "POST /email": () => json({ account: { email: "new@example.com", createdAt: SAVED.createdAt } }),
    });
    const { account, kept } = client(fetchImpl, { saved: SAVED });
    await account.init();
    await account.sendEmailCode("new@example.com");
    expect(account.view().pending).toEqual({ kind: "change-email", email: "new@example.com" });
    await account.changeEmail("111111");
    expect(calls[1]!.body).toEqual({ email: "new@example.com", code: "111111", language: "de" });
    expect(account.view()).toMatchObject({ account: { email: "new@example.com" }, pending: null });
    expect(kept).toEqual([{ ...SAVED, email: "new@example.com" }]);
  });

  it("deletes the account with a code and forgets it here", async () => {
    const { calls, fetchImpl } = service({ "POST /delete/code": () => json({ status: "sent" }, 202), "POST /delete": () => new Response(null, { status: 204 }) });
    const { account, kept } = client(fetchImpl, { saved: SAVED });
    await account.init();
    await expect(account.deleteAccount("222222")).rejects.toMatchObject({ key: "account.error.noCode" });
    await account.sendDeleteCode();
    await account.deleteAccount("222222");
    expect(calls.map((call) => call.auth)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    expect(account.view()).toMatchObject({ account: null, pending: null });
    expect(kept).toEqual([null]);
  });

  it("signs out another device and reads the list again", async () => {
    const { calls, fetchImpl } = service({ "DELETE /devices/dev2": () => new Response(null, { status: 204 }), "GET /": () => json({ devices: [DEVICE] }) });
    const { account } = client(fetchImpl, { saved: SAVED });
    await account.init();
    await account.signOutDevice("dev2");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["DELETE https://api.test/v1/account/devices/dev2", "GET https://api.test/v1/account"]);
    expect(account.view().devices).toEqual([DEVICE]);
  });
});

describe("the sign-in on disk", () => {
  const file = async () => path.join(await mkdtemp(path.join(os.tmpdir(), "tavora-account-")), "account.json");

  it("is kept encrypted and read back", async () => {
    const where = await file();
    await saveAccount(where, encryptor(), SAVED);
    expect(await readFile(where, "utf8")).not.toContain(TOKEN);
    expect(await loadAccount(where, encryptor())).toEqual(SAVED);
  });

  it("is removed on sign-out, and never written without encryption", async () => {
    const where = await file();
    await saveAccount(where, encryptor(), SAVED);
    await saveAccount(where, encryptor(), null);
    await expect(stat(where)).rejects.toThrow();
    await saveAccount(where, encryptor(false), SAVED);
    await expect(stat(where)).rejects.toThrow();
  });

  it("reads a damaged or foreign file as signed out", async () => {
    const where = await file();
    await saveAccount(where, encryptor(), { ...SAVED, token: "short" });
    expect(await loadAccount(where, encryptor())).toBeNull();
    expect(await loadAccount(where, encryptor(false))).toBeNull();
    expect(await loadAccount(path.join(where, "missing"), encryptor())).toBeNull();
  });

  it("names the operating system only", () => {
    expect([deviceOs("win32"), deviceOs("linux"), deviceOs("darwin"), deviceOs("freebsd")]).toEqual(["windows", "linux", "macos", "other"]);
  });
});

describe("the profile in the account", () => {
  const ALEX: ProfileData = { name: "Alex", initials: "AX", picture: "cGlj", updatedAt: "2026-10-16T10:00:00.000Z" };
  const OTHER = { name: "Sam", initials: "SM", picture: null, updatedAt: "2026-10-16T11:00:00.000Z" };
  const signInWith = (answers: Record<string, (body: Record<string, unknown> | undefined) => Response>) =>
    service({ "POST /code": () => json({}, 202), "POST /verify": signedInAnswer("signed-in"), "GET /": () => json({ devices: [] }), ...answers });

  it("a new account takes this PC's profile", async () => {
    const { calls, fetchImpl } = signInWith({ "GET /profile": () => json({ profile: null }), "PUT /profile": (body) => json({ profile: body }) });
    const { account, local } = client(fetchImpl, { profile: ALEX });
    await account.sendCode("me@example.com");
    await account.verify("123456");
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual(ALEX);
    expect(local.applied).toEqual([]);
  });

  it("a PC with the empty default takes the account's quietly", async () => {
    const { fetchImpl } = signInWith({ "GET /profile": () => json({ profile: ALEX }) });
    const { account, local } = client(fetchImpl);
    await account.sendCode("me@example.com");
    await account.verify("123456");
    expect(local.applied).toEqual([ALEX]);
    expect(account.view().profileChoice).toBeNull();
  });

  it("asks once when both have a different profile, and keeps the answer", async () => {
    const { calls, fetchImpl } = signInWith({ "GET /profile": () => json({ profile: OTHER }), "PUT /profile": (body) => json({ profile: body }) });
    const first = client(fetchImpl, { profile: ALEX });
    await first.account.sendCode("me@example.com");
    await first.account.verify("123456");
    expect(first.account.view().profileChoice).toEqual({ name: "Sam", initials: "SM", picture: false });
    expect(first.local.applied).toEqual([]);
    await first.account.chooseProfile("account");
    expect(first.local.applied).toEqual([OTHER]);
    expect(first.account.view().profileChoice).toBeNull();

    const second = client(fetchImpl, { profile: ALEX });
    await second.account.sendCode("me@example.com");
    await second.account.verify("123456");
    await second.account.chooseProfile("pc");
    const put = calls.filter((call) => call.method === "PUT").at(-1)!;
    // This PC's profile, made the newest so every other PC takes it.
    expect(put.body).toMatchObject({ name: "Alex", initials: "AX", picture: "cGlj" });
    expect(Date.parse(String(put.body!.updatedAt))).toBeGreaterThan(Date.parse(OTHER.updatedAt));
  });

  it("at a start, the newer one wins", async () => {
    const newer = service({ "GET /profile": () => json({ profile: OTHER }) });
    const pcOlder = client(newer.fetchImpl, { saved: SAVED, profile: ALEX });
    await pcOlder.account.init();
    await expect.poll(() => pcOlder.local.applied).toEqual([OTHER]);

    const older = service({ "GET /profile": () => json({ profile: { ...OTHER, updatedAt: "2026-10-16T09:00:00.000Z" } }), "PUT /profile": (body) => json({ profile: body }) });
    const pcNewer = client(older.fetchImpl, { saved: SAVED, profile: ALEX });
    await pcNewer.account.init();
    await expect.poll(() => older.calls.some((call) => call.method === "PUT")).toBe(true);
    expect(pcNewer.local.applied).toEqual([]);
  });

  it("sends a change up, and takes a newer one the account already had", async () => {
    const { calls, fetchImpl } = service({ "PUT /profile": () => json({ profile: OTHER }) });
    const { account, local } = client(fetchImpl, { saved: SAVED, profile: ALEX });
    (account as unknown as { saved: SavedAccount }).saved = SAVED;
    await account.profileChanged();
    expect(calls.map((call) => call.method)).toEqual(["PUT"]);
    expect(local.applied).toEqual([OTHER]);
  });

  it("sends nothing while signed out", async () => {
    const { calls, fetchImpl } = service({});
    const { account } = client(fetchImpl, { profile: ALEX });
    await account.profileChanged();
    expect(calls).toEqual([]);
  });
});

describe("Discord login", () => {
  const LOGIN = { code: "codewellbrained", verifier: "v".repeat(43) };
  const discordAccount = (email: string | null, name: string | null) => ({ email, discord: name ? { name } : null, createdAt: SAVED.createdAt });

  it("signs a known Discord login in, keeping its username and no email", async () => {
    const { calls, fetchImpl } = service({
      "POST /discord/sign-in": () => json({ status: "signed-in", token: TOKEN, device: "dev1", account: discordAccount(null, "alex") }),
      "GET /": () => json({ account: discordAccount(null, "alex"), devices: [] }),
    });
    const { account, kept } = client(fetchImpl, { discordLogin: async () => LOGIN });
    await account.discordSignIn();
    expect(calls[0]!.body).toEqual({ ...LOGIN, os: "windows" });
    expect(account.view()).toMatchObject({ discordLogin: true, account: { email: null, discord: { name: "alex" } } });
    expect(kept[0]).toEqual({ token: TOKEN, email: null, discord: "alex", createdAt: SAVED.createdAt });
  });

  it("asks before making an account for a new Discord login, and needs the age tick", async () => {
    const { calls, fetchImpl } = service({
      "POST /discord/sign-in": () => json({ status: "no-account", ticket: "t".repeat(43), discord: { name: "alex" } }),
      "POST /discord/create": () => json({ status: "created", token: TOKEN, device: "dev1", account: discordAccount(null, "alex") }),
    });
    const { account } = client(fetchImpl, { discordLogin: async () => LOGIN });
    await account.discordSignIn();
    expect(account.view().pending).toEqual({ kind: "discord-create", name: "alex" });
    await expect(account.create(false)).rejects.toMatchObject({ key: "account.error.ageRequired" });
    await account.create(true);
    expect(calls.find((call) => call.url.endsWith("/discord/create"))!.body).toEqual({ ticket: "t".repeat(43), os: "windows" });
    expect(account.view().account).toMatchObject({ discord: { name: "alex" } });
  });

  it("connects and disconnects Discord, removes the email with a code, and says why the last method stays", async () => {
    const { calls, fetchImpl } = service({
      "POST /discord/code": () => json({ status: "sent" }, 202),
      "POST /discord": () => json({ account: discordAccount("me@example.com", "alex") }),
      "POST /email/remove/code": () => json({ status: "sent" }, 202),
      "POST /email/remove": () => json({ account: discordAccount(null, "alex") }),
      "POST /discord/remove/code": () => json({ status: "sent" }, 202),
      "POST /discord/remove": () => json({ reason: "last-method" }, 409),
    });
    const { account, kept } = client(fetchImpl, { saved: SAVED, discordLogin: async () => LOGIN });
    await account.init();
    // Connecting: a code to the account's address first, then the Discord sign-in goes along with it.
    await expect(account.connectDiscord("654321")).rejects.toMatchObject({ key: "account.error.noCode" });
    await account.sendConnectDiscordCode();
    expect(account.view().pending).toEqual({ kind: "connect-discord" });
    await account.connectDiscord("654321");
    expect(calls.find((call) => call.url.endsWith("/discord"))!.body).toEqual({ ...LOGIN, emailCode: "654321" });
    expect(account.view().pending).toBeNull();
    expect(account.view().account).toMatchObject({ email: "me@example.com", discord: { name: "alex" } });
    // No code asked for yet: nothing is removed.
    await expect(account.removeEmail("123456")).rejects.toMatchObject({ key: "account.error.noCode" });
    await account.sendRemoveEmailCode();
    expect(account.view().pending).toEqual({ kind: "remove-email" });
    await account.removeEmail("123456");
    expect(calls.find((call) => call.url.endsWith("/email/remove"))!.body).toEqual({ code: "123456" });
    expect(account.view().pending).toBeNull();
    expect(kept.at(-1)).toMatchObject({ email: null, discord: "alex" });
    // Disconnecting needs a code to the address too; no Discord sign-in, so a lost login can always go.
    await expect(account.disconnectDiscord("111111")).rejects.toMatchObject({ key: "account.error.noCode" });
    await account.sendDisconnectDiscordCode();
    expect(account.view().pending).toEqual({ kind: "remove-discord" });
    await expect(account.disconnectDiscord("111111")).rejects.toMatchObject({ key: "account.error.lastMethod" });
    expect(calls.find((call) => call.url.endsWith("/discord/remove"))!.body).toEqual({ code: "111111" });
    expect(account.view().account).toMatchObject({ discord: { name: "alex" } });
  });

  it("says when the account already has another Discord login", async () => {
    const { fetchImpl } = service({ "POST /discord/code": () => json({ reason: "discord-connected" }, 409) });
    const { account } = client(fetchImpl, { saved: SAVED, discordLogin: async () => LOGIN });
    await account.init();
    await expect(account.sendConnectDiscordCode()).rejects.toMatchObject({ key: "account.error.discordConnected" });
  });

  it("tells a Discord login another account has apart", async () => {
    const { fetchImpl } = service({ "POST /discord/code": () => json({ status: "sent" }, 202), "POST /discord": () => json({ reason: "discord-taken" }, 409) });
    const { account } = client(fetchImpl, { saved: SAVED, discordLogin: async () => LOGIN });
    await account.init();
    await account.sendConnectDiscordCode();
    await expect(account.connectDiscord("654321")).rejects.toMatchObject({ key: "account.error.discordTaken" });
  });

  it("deletes a Discord-only account with a fresh Discord sign-in", async () => {
    const { calls, fetchImpl } = service({ "POST /delete/discord": () => new Response(null, { status: 204 }) });
    const { account, kept } = client(fetchImpl, { saved: { ...SAVED, email: null, discord: "alex" }, discordLogin: async () => LOGIN });
    await account.init();
    await account.deleteWithDiscord();
    expect(calls[0]!.body).toEqual(LOGIN);
    expect(account.view().account).toBeNull();
    expect(kept).toEqual([null]);
  });

  it("is not offered without a browser sign-in, and reads a 0.16 sign-in file", async () => {
    const { account } = client(service({}).fetchImpl);
    await expect(account.discordSignIn()).rejects.toMatchObject({ key: "account.error.unavailable" });
    const where = path.join(await mkdtemp(path.join(os.tmpdir(), "tavora-account-")), "account.json");
    const old = { token: TOKEN, email: "me@example.com", createdAt: SAVED.createdAt };
    await saveAccount(where, encryptor(), old as unknown as SavedAccount);
    expect(await loadAccount(where, encryptor())).toEqual({ ...old, discord: null });
  });
});