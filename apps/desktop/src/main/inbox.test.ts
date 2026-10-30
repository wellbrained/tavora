import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Inbox, parseItem, parseMessage, type InboxOptions } from "./inbox";

const ID = "AbCdEfGhIjKlMnOp";
const ID2 = "ZyXwVuTsRqPoNmLk";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const row = (fields: Record<string, unknown> = {}) => ({
  id: ID,
  kind: "developer",
  role: "user",
  module: { id: "wellbrained.timer", name: "Timer" },
  type: "bug",
  label: "K7",
  title: "Developer of Timer (Wellbrained)",
  state: "open",
  closeReason: null,
  createdAt: "2026-10-27T10:00:00.000Z",
  lastMessageAt: "2026-10-27T10:00:00.000Z",
  closedAt: null,
  unread: false,
  previousId: null,
  closesInDays: null,
  ...fields,
});

/** A pretend service: what GET /v1/conversations answers, and every request made. */
function service() {
  const state = { conversations: [] as unknown[], developer: false, texts: {} as Record<string, unknown>, calls: [] as { method: string; url: string; body: unknown }[] };
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input).replace("https://api.test", "");
    const method = init?.method ?? "GET";
    state.calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/v1/conversations" && method === "GET") return json({ conversations: state.conversations, inbox: { open: 0, unread: 0, developer: state.developer } });
    if (url === "/v1/conversations/settings") return json({ emailCopies: true, hasEmail: true });
    if (url === "/v1/texts") return json({ texts: state.texts });
    if (url === "/v1/catalog/modules/wellbrained.timer") return json({ module: { id: "wellbrained.timer", name: "Timer", version: "1.2.0", contact: { enabled: true, link: null } } });
    if (url === "/v1/catalog/modules/wellbrained.discord") return json({ module: { id: "wellbrained.discord", name: "Chat", version: "1.0.0", contact: { kind: "discord-user", value: "wellbrained", enabled: false, link: null } } });
    if (url === "/v1/catalog/modules/wellbrained.quiet") return json({ module: { id: "wellbrained.quiet", name: "Quiet", version: "1.0.0", contact: { enabled: false, link: "https://github.com/x/y/issues" } } });
    if (url === "/v1/conversations" && method === "POST") {
      state.conversations = [row()];
      return json({ conversation: row(), messages: [] }, 201);
    }
    if (/^\/v1\/conversations\/[A-Za-z0-9_-]{16}\/(block|report|close|messages)$/.test(url)) return json({ conversation: row(), messages: [] });
    return json({ error: "Not found.", reason: "not-found" }, 404);
  }) as typeof fetch;
  return { state, impl };
}

async function make(overrides: Partial<InboxOptions> = {}, fake = service()) {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-inbox-"));
  const views: ReturnType<Inbox["view"]>[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const inbox = new Inbox({
    baseUrl: "https://api.test",
    fetch: fake.impl,
    token: () => "t".repeat(30),
    language: () => "en",
    tavoraVersion: "0.21.44",
    file: path.join(dir, "inbox.json"),
    installedVersion: () => undefined,
    isDeveloper: () => false,
    ownModules: async () => [],
    onChange: (view) => views.push(view),
    openLink: (url) => opened.push(url),
    copy: (text) => copied.push(text),
    pollMs: 3_600_000,
    ...overrides,
  });
  await inbox.init();
  await inbox.refresh();
  return { inbox, fake, views, opened, copied, file: path.join(dir, "inbox.json") };
}

describe("parsing what the service sends", () => {
  it("keeps a conversation with the shape the app relies on", () => {
    expect(parseItem(row())).toMatchObject({ id: ID, role: "user", state: "open", label: "K7" });
    expect(parseItem(row({ closeReason: "fixed", state: "closed" }))).toMatchObject({ closeReason: "fixed" });
  });

  it("drops what does not fit", () => {
    expect(parseItem(null)).toBeNull();
    expect(parseItem(row({ id: "short" }))).toBeNull();
    expect(parseItem(row({ kind: "other" }))).toBeNull();
    expect(parseItem(row({ state: "weird" }))).toBeNull();
    expect(parseItem(row({ createdAt: "nope" }))).toBeNull();
    expect(parseItem(row({ closeReason: "invented" }))).toMatchObject({ closeReason: null });
    expect(parseItem(row({ closesInDays: 99 }))).toMatchObject({ closesInDays: null });
  });

  it("reads a message as plain text", () => {
    expect(parseMessage({ id: 1, from: "user", mine: true, text: "<b>hi</b>", at: "2026-10-27T10:00:00.000Z", versions: { tavora: "0.21.44", module: "1.2.0" } })).toMatchObject({ text: "<b>hi</b>", mine: true, versions: { module: "1.2.0" } });
    expect(parseMessage({ id: 1, from: "nobody", text: "x", at: "2026-10-27T10:00:00.000Z" })).toBeNull();
    expect(parseMessage({ id: 1, from: "user", text: "x", at: "yesterday" })).toBeNull();
  });
});

describe("the inbox view", () => {
  it("is empty without a sign-in and asks nothing", async () => {
    const fake = service();
    const { inbox } = await make({ token: () => null }, fake);
    expect(inbox.view().active).toBe(false);
    expect(fake.state.calls).toHaveLength(0);
  });

  it("shows no icon for a user without open conversations", async () => {
    const { inbox } = await make();
    expect(inbox.view()).toMatchObject({ active: true, icon: false, unread: 0, note: null });
  });

  it("shows the icon for a developer, even when empty", async () => {
    const fake = service();
    fake.state.developer = true;
    const { inbox } = await make({}, fake);
    expect(inbox.view()).toMatchObject({ icon: true, cause: "developer", items: [], why: null });
  });

  it("counts conversations with news in the badge", async () => {
    const fake = service();
    fake.state.conversations = [row({ unread: true }), row({ id: ID2, unread: true }), row({ id: "QwErTyUiOpAsDfGh" })];
    const { inbox } = await make({}, fake);
    expect(inbox.view().unread).toBe(2);
  });

  it("explains the icon once, by cause, then the icon going away once", async () => {
    const fake = service();
    fake.state.conversations = [row({ kind: "tavora", module: null, title: "Tavora" })];
    const { inbox, file } = await make({}, fake);
    expect(inbox.view().note).toMatchObject({ kind: "appeared" });
    expect(inbox.view().why).not.toBeNull();
    await inbox.noteSeen();
    expect(inbox.view().note).toBeNull();
    // Still shown on the next look: no second note.
    await inbox.refresh();
    expect(inbox.view().note).toBeNull();
    // Everything closed: one note that it went away.
    fake.state.conversations = [row({ kind: "tavora", module: null, title: "Tavora", state: "closed", closeReason: "tavora" })];
    await inbox.refresh();
    expect(inbox.view().icon).toBe(false);
    expect(inbox.view().note).toMatchObject({ kind: "gone" });
    await inbox.noteSeen();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ goneNoted: true, appeared: ["tavora"], pending: null });
    // Back and gone again: the same causes are not explained twice.
    fake.state.conversations = [row({ kind: "tavora", module: null, title: "Tavora" })];
    await inbox.refresh();
    expect(inbox.view().note).toBeNull();
    fake.state.conversations = [];
    await inbox.refresh();
    expect(inbox.view().note).toBeNull();
  });

  it("uses the admin's edited text, and fills its placeholders", async () => {
    const fake = service();
    fake.state.texts = { "inbox.appeared.developerReply": { en: "*{developer}* answered about {module}.", de: "" } };
    fake.state.conversations = [row({ unread: true })];
    const { inbox } = await make({}, fake);
    expect(inbox.view().note).toMatchObject({ kind: "appeared", paragraphs: [[{ text: "Wellbrained", em: true }, { text: " answered about Timer.", em: false }]] });
  });

  it("asks developers for the one-time note once", async () => {
    const fake = service();
    fake.state.developer = true;
    const { inbox } = await make({}, fake);
    expect(inbox.view().developerNote).toBe(true);
    await inbox.developerNoteSeen();
    expect(inbox.view().developerNote).toBe(false);
  });
});

describe("writing", () => {
  it("fills in both versions and sends the request, then explains the icon as sent", async () => {
    const fake = service();
    const { inbox } = await make({ installedVersion: (id) => (id === "wellbrained.timer" ? "1.1.0" : undefined) }, fake);
    const id = await inbox.sendRequest("wellbrained.timer", "bug", "  It crashes.  ");
    expect(id).toBe(ID);
    const post = fake.state.calls.find((call) => call.method === "POST")!;
    expect(post.body).toEqual({ moduleId: "wellbrained.timer", type: "bug", text: "It crashes.", versions: { tavora: "0.21.44", module: "1.1.0" } });
    expect(inbox.view().note).toMatchObject({ kind: "appeared" });
    expect(inbox.view().cause).toBe("sent");
  });

  it("offers the public link when contact is off, and refuses to send", async () => {
    const { inbox, opened } = await make();
    // An older service sends only on or off and a link.
    expect(await inbox.contactDraft("wellbrained.quiet")).toEqual({ status: "off", moduleName: "Quiet", kind: "github", value: "https://github.com/x/y/issues", host: "github.com" });
    await expect(inbox.sendRequest("wellbrained.quiet", "bug", "Hi")).rejects.toMatchObject({ key: "inbox.error.contactOff" });
    expect(await inbox.openContactLink("wellbrained.quiet")).toBe("opened");
    expect(opened).toEqual(["https://github.com/x/y/issues"]);
  });

  it("copies a Discord name the developer chose instead of opening anything", async () => {
    const { inbox, opened, copied } = await make();
    expect(await inbox.contactDraft("wellbrained.discord")).toEqual({ status: "off", moduleName: "Chat", kind: "discord-user", value: "wellbrained", host: null });
    expect(await inbox.openContactLink("wellbrained.discord")).toBe("copied");
    expect(copied).toEqual(["wellbrained"]);
    expect(opened).toEqual([]);
  });

  it("needs a sign-in for the draft", async () => {
    const { inbox } = await make({ token: () => null });
    expect(await inbox.contactDraft("wellbrained.timer")).toEqual({ status: "signed-out" });
  });

  it("turns the service's refusals into friendly messages", async () => {
    const fake = service();
    const refusing = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/messages")) return json({ error: "x", reason: "message-link" }, 400);
      if (String(input).endsWith("/close")) return json({ error: "x", reason: "account-too-new", hours: 5 }, 403);
      return fake.impl(input, init);
    }) as typeof fetch;
    const { inbox } = await make({ fetch: refusing }, fake);
    await expect(inbox.reply(ID, "see https://x.test")).rejects.toMatchObject({ key: "inbox.error.link" });
    await expect(inbox.close(ID)).rejects.toMatchObject({ key: "inbox.error.tooNew", params: { hours: 5 } });
  });

  it("sends the report with the block, and only a trimmed note", async () => {
    const { inbox, fake } = await make();
    await inbox.block(ID, { reason: "insults", note: "  Rude.  " });
    expect(fake.state.calls.find((call) => call.url.endsWith("/block"))!.body).toEqual({ report: { reason: "insults", note: "Rude." } });
  });
});
