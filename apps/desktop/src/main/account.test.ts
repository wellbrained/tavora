import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AccountView } from "../shared/host-api";
import { AccountClient, deviceOs, loadAccount, saveAccount, type SavedAccount } from "./account";
import type { Encryptor } from "./discord-store";
import { PlayerError } from "./messages";

// Stands in for safeStorage: reversible, and never the plain text.
const encryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  decrypt: (data) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
});

const TOKEN = "t".repeat(43);
const SAVED: SavedAccount = { token: TOKEN, email: "me@example.com", createdAt: "2026-10-16T12:00:00.000Z" };
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
    calls.push({ method, url, body, auth: new Headers(init?.headers).get("authorization") });
    const answer = answers[`${method} ${url.replace("https://api.test/v1/account", "") || "/"}`];
    return answer ? answer(body) : json({ error: "Not found." }, 404);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(fetchImpl: typeof fetch, options: { saved?: SavedAccount | null; enabled?: boolean; canKeep?: boolean } = {}) {
  const views: AccountView[] = [];
  const kept: (SavedAccount | null)[] = [];
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
  });
  return { account, views, kept };
}

const signedInAnswer = (status: "signed-in" | "created") => () =>
  json({ status, token: TOKEN, device: "dev1", account: { email: "me@example.com", createdAt: SAVED.createdAt } });

describe("signing in", () => {
  it("sends a code, then signs an existing account in and reads its devices", async () => {
    const { calls, fetchImpl } = service({
      "POST /code": () => json({ status: "sent" }, 202),
      "POST /verify": signedInAnswer("signed-in"),
      "GET /": () => json({ account: { email: "me@example.com", createdAt: SAVED.createdAt }, devices: [DEVICE, { id: 5 }] }),
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
    ]);
    expect(calls[0]!.body).toEqual({ email: "me@example.com", language: "de" });
    expect(calls[1]!.body).toEqual({ email: "me@example.com", code: "123456", os: "windows" });
    expect(calls[2]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(kept).toEqual([SAVED]);
    // The token never reaches the host UI; a malformed device is dropped.
    const view = account.view();
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(view).toEqual({ enabled: true, canKeepSignIn: true, account: { email: "me@example.com", createdAt: SAVED.createdAt }, devices: [DEVICE], pending: null });
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
    await account.create();
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
