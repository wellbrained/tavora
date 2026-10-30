import { describe, expect, it } from "vitest";
import { BUILT_IN_TEXTS, cleanContactValue, contactToLegacy, developerNameOf, readContact, fillPlaceholders, groupConversations, inboxCause, inboxIcon, linkHost, messageProblem, noteParagraphs, noteText, type ConversationItem } from "./conversations";
import { en } from "./locales/en";

const item = (fields: Partial<ConversationItem> = {}): ConversationItem => ({
  id: "AbCdEfGhIjKlMnOp",
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

describe("the inbox icon", () => {
  it("shows for an open conversation, and always for a developer", () => {
    expect(inboxIcon([], false)).toBe(false);
    expect(inboxIcon(null, false)).toBe(false);
    expect(inboxIcon([item({ state: "closed" })], false)).toBe(false);
    expect(inboxIcon([item()], false)).toBe(true);
    expect(inboxIcon([], true)).toBe(true);
  });

  it("names the cause", () => {
    expect(inboxCause([item()], false, true)).toBe("sent");
    expect(inboxCause([item()], false)).toBe("sent");
    expect(inboxCause([item({ unread: true })], false)).toBe("developerReply");
    expect(inboxCause([item({ unread: true })], false, true)).toBe("sent");
    expect(inboxCause([item({ kind: "tavora", module: null })], false)).toBe("tavora");
    expect(inboxCause([], true)).toBe("developer");
    expect(inboxCause([], false)).toBeNull();
  });
});

describe("notes", () => {
  it("fills known placeholders, empties missing ones and leaves unknown ones", () => {
    expect(fillPlaceholders("{module} by {developer}, {days} days {what}", { module: "Timer", days: "30" })).toBe("Timer by , 30 days {what}");
  });

  it("splits paragraphs and *emphasis* into plain pieces", () => {
    expect(noteParagraphs("One *two* three\n\nFour")).toEqual([
      [
        { text: "One ", em: false },
        { text: "two", em: true },
        { text: " three", em: false },
      ],
      [{ text: "Four", em: false }],
    ]);
  });

  it("uses the saved text for the language, else the built-in one", () => {
    const saved = { "inbox.appeared.sent": { en: "Hi *{module}*", de: "" } };
    expect(noteText("inbox.appeared.sent", "en", saved, { module: "Timer" })[0]).toEqual([
      { text: "Hi ", em: false },
      { text: "Timer", em: true },
    ]);
    expect(noteText("inbox.appeared.sent", "de", saved, { module: "Timer", days: "30" })[0]!.map((span) => span.text).join("")).toContain("Timer");
    expect(noteText("inbox.gone", "en", null, {})).toHaveLength(2);
  });

  it("has a built-in text in both languages for every key, with only allowed placeholders", () => {
    for (const texts of Object.values(BUILT_IN_TEXTS)) {
      for (const text of Object.values(texts)) {
        expect(text.trim()).not.toBe("");
        for (const match of text.matchAll(/\{(\w+)\}/g)) expect(["module", "developer", "days", "reason"]).toContain(match[1]);
      }
    }
  });
});

describe("reading a list", () => {
  it("takes the developer name out of the service title", () => {
    expect(developerNameOf(item())).toBe("Wellbrained");
    expect(developerNameOf(item({ title: "Developer of Timer" }))).toBeNull();
    expect(developerNameOf(item({ module: null }))).toBeNull();
  });

  it("groups by module, Tavora last, newest first inside", () => {
    const groups = groupConversations([
      item({ id: "a", lastMessageAt: "2026-10-01T00:00:00.000Z" }),
      item({ id: "b", lastMessageAt: "2026-10-02T00:00:00.000Z" }),
      item({ id: "c", module: { id: "wellbrained.alarm", name: "Alarm" } }),
      item({ id: "d", kind: "tavora", module: null }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["wellbrained.alarm", "wellbrained.timer", "tavora"]);
    expect(groups[1]!.items.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("messages and links", () => {
  it("counts characters, not code units", () => {
    expect(messageProblem("   ")).toBe("empty");
    expect(messageProblem("a".repeat(2000))).toBeNull();
    expect(messageProblem("a".repeat(2001))).toBe("long");
    expect(messageProblem("😀".repeat(2000))).toBeNull();
  });

  it("shows the host of https links only", () => {
    expect(linkHost("https://github.com/wellbrained/timer/issues")).toBe("github.com");
    expect(linkHost("http://github.com")).toBeNull();
    expect(linkHost("javascript:alert(1)")).toBeNull();
    expect(linkHost(null)).toBeNull();
  });
});

describe("the texts", () => {
  it("has English and German for the texts the app shows for messages", () => {
    expect(en["inbox.empty"]).toBe("No messages yet");
    expect(en["contact.anonymous"]).toBe("The developer won't see your name or email.");
  });
});

describe("contact kinds", () => {
  it("clean the value for its kind, and refuse one that doesn't fit", () => {
    expect(cleanContactValue("email", " dev@example.com ")).toBe("dev@example.com");
    expect(cleanContactValue("email", "dev@example")).toBeUndefined();
    expect(cleanContactValue("github", "github.com/wellbrained/timer/issues")).toBe("https://github.com/wellbrained/timer/issues");
    expect(cleanContactValue("github", "https://gitlab.com/x")).toBeUndefined();
    expect(cleanContactValue("discord-server", "https://discord.com/invite/abc")).toBe("https://discord.com/invite/abc");
    expect(cleanContactValue("discord-server", "https://discord.com/users/123")).toBeUndefined();
    expect(cleanContactValue("discord-user", "@WellBrained")).toBe("wellbrained");
    expect(cleanContactValue("discord-user", "a..b")).toBeUndefined();
    expect(cleanContactValue("website", "http://example.com")).toBeUndefined();
    expect(cleanContactValue("tavora", null)).toBeNull();
    expect(cleanContactValue("none", "x")).toBeUndefined();
  });

  it("read an older service's on or off and link as a kind", () => {
    expect(readContact({ enabled: true, link: null })).toEqual({ kind: "tavora", value: null });
    expect(readContact({ enabled: false, link: null })).toEqual({ kind: "none", value: null });
    expect(readContact({ enabled: false, link: "https://discord.gg/abc" })).toEqual({ kind: "discord-server", value: "https://discord.gg/abc" });
    expect(readContact({ enabled: false, link: "https://example.com/help" })).toEqual({ kind: "website", value: "https://example.com/help" });
    expect(readContact({ kind: "discord-user", value: "wellbrained", enabled: false, link: null })).toEqual({ kind: "discord-user", value: "wellbrained" });
    expect(readContact(undefined)).toEqual({ kind: "tavora", value: null });
  });

  it("tell an older app on or off, with the link only for a link", () => {
    expect(contactToLegacy({ kind: "email", value: "dev@example.com" })).toEqual({ enabled: false, link: null });
    expect(contactToLegacy({ kind: "github", value: "https://github.com/x" })).toEqual({ enabled: false, link: "https://github.com/x" });
    expect(contactToLegacy({ kind: "tavora", value: null })).toEqual({ enabled: true, link: null });
  });
});
