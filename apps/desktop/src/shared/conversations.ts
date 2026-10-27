// Conversations between a user and a module's developer, or between Tavora and an account (decided 2026-10-27,
// "Conversations" in the Tavora Admin design doc). The shapes here are what the Tavora service sends
// (apps/api/src/conversations.ts) and what the host UI gets; the texts of the explanation notes are here too,
// so the main process and the tests share them.
import type { Language } from "./i18n";

export const REQUEST_TYPES = ["bug", "feature", "question"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
/** The outcomes a developer closes with. */
export const OUTCOMES = ["fixed", "added", "not-planned", "not-a-bug", "none"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type CloseReason = Outcome | "user" | "timeout" | "blocked" | "tavora" | "left";
export const CLOSE_REASONS: readonly CloseReason[] = [...OUTCOMES, "user", "timeout", "blocked", "tavora", "left"];
export const CONVERSATION_REPORT_REASONS = ["insults", "hateful", "spam", "other"] as const;
export type ConversationReportReason = (typeof CONVERSATION_REPORT_REASONS)[number];
export const MODULE_REPORT_REASONS = ["unsafe", "hateful", "adult", "spam", "broken", "other"] as const;
export type ModuleReportReason = (typeof MODULE_REPORT_REASONS)[number];

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NOTE_LENGTH = 500;
/** Days without a message after which a developer conversation closes by itself (the service's rule; only used in texts). */
export const IDLE_DAYS = 30;

export interface ConversationItem {
  id: string;
  kind: "developer" | "tavora";
  /** Which side the signed-in account is. */
  role: "user" | "developer";
  module: { id: string; name: string } | null;
  type: RequestType | null;
  /** The pseudonym the developer sees the user as: "K7". */
  label: string;
  /** The other side as the service names it, in English: "Developer of Timer (Wellbrained)", "User · K7" or "Tavora". */
  title: string;
  state: "open" | "closed";
  closeReason: CloseReason | null;
  createdAt: string;
  lastMessageAt: string;
  closedAt: string | null;
  /** The signed-in side has a message it has not read. */
  unread: boolean;
  /** The closed conversation this one follows. */
  previousId: string | null;
  /** Days until it closes by itself, once that is at most three days away. */
  closesInDays: number | null;
}

export interface ConversationMessage {
  id: number;
  from: "user" | "developer" | "tavora";
  mine: boolean;
  text: string;
  at: string;
  /** On the first message of a request: the Tavora and module version it was sent from. */
  versions?: { tavora: string; module: string };
}

export interface ConversationDetail {
  conversation: ConversationItem;
  messages: ConversationMessage[];
}

export type ConversationDetailResult = ({ status: "ok" } & ConversationDetail) | { status: "error"; error: string };

/** A module's contact settings: on by default, with an optional https link instead. */
export interface ModuleContact {
  id: string;
  name: string;
  enabled: boolean;
  link: string | null;
}

/** A piece of a note: plain, or emphasised (*like this* in the editable text). Never markup. */
export interface NoteSpan {
  text: string;
  em: boolean;
}
export type NoteParagraphs = NoteSpan[][];

/** Why the inbox icon is in the header. */
export type InboxCause = "sent" | "tavora" | "developerReply" | "developer";

export interface InboxNote {
  /** What happened: the icon appeared (with its cause) or went away. */
  kind: "appeared" | "gone";
  paragraphs: NoteParagraphs;
}

/** What the host UI knows about messages: the header icon, the notes and the lists. */
export interface InboxView {
  /** Signed in, with online features on. Otherwise nothing else is filled. */
  active: boolean;
  /** Null until read from the service. */
  items: ConversationItem[] | null;
  /** The account has a published module that takes messages. */
  developer: boolean;
  /** The inbox icon shows in the header. */
  icon: boolean;
  /** Conversations with messages the account has not read. */
  unread: number;
  cause: InboxCause | null;
  /** "Why is this here?": the explanation for the cause. */
  why: NoteParagraphs | null;
  /** The note to show now, once per cause. */
  note: InboxNote | null;
  /** The email copy switch; null until read. */
  emailCopies: { on: boolean; hasEmail: boolean } | null;
  /** The one-time note for developers is waiting. */
  developerNote: boolean;
  /** The account's published modules and whether they take messages; null until read. */
  contacts: ModuleContact[] | null;
}

export const EMPTY_INBOX: InboxView = { active: false, items: null, developer: false, icon: false, unread: 0, cause: null, why: null, note: null, emailCopies: null, developerNote: false, contacts: null };

/** What the dialogs need before a request is written: the contact state and the versions that go with it. */
export type ContactDraft =
  | { status: "ok"; moduleName: string; versions: { tavora: string; module: string } }
  | { status: "off"; moduleName: string; link: string | null; host: string | null }
  | { status: "signed-out" | "own" | "error"; error?: string };

// ── Texts ──────────────────────────────────────────────────────────────

/** The editable texts the service keeps, by key; a language left empty uses the built-in text. */
export type NoteTexts = Record<string, { en: string; de: string }>;

export type NoteKey = "inbox.appeared.sent" | "inbox.appeared.tavora" | "inbox.appeared.developerReply" | "inbox.gone";
export const NOTE_KEYS: readonly NoteKey[] = ["inbox.appeared.sent", "inbox.appeared.tavora", "inbox.appeared.developerReply", "inbox.gone"];

/** The built-in texts, used until (and unless) the admin edited one. Placeholders: {module}, {developer}, {days}, {reason}. */
export const BUILT_IN_TEXTS: Record<NoteKey, Record<Language, string>> = {
  "inbox.appeared.sent": {
    en: "You sent the developer of *{module}* a request. Their answer arrives here.\n\nIt closes when the developer marks it done or nobody writes for {days} days, and this icon goes again.",
    de: "Du hast dem Entwickler von *{module}* eine Anfrage geschickt. Seine Antwort kommt hierher.\n\nSie wird geschlossen, wenn der Entwickler sie als erledigt markiert oder {days} Tage lang niemand schreibt. Dann verschwindet dieses Symbol wieder.",
  },
  "inbox.appeared.tavora": {
    en: "Tavora wrote to you. You can answer here.\n\nThis icon goes again once Tavora has closed the conversation.",
    de: "Tavora hat dir geschrieben. Du kannst hier antworten.\n\nDieses Symbol verschwindet wieder, sobald Tavora die Unterhaltung geschlossen hat.",
  },
  "inbox.appeared.developerReply": {
    en: "The developer of *{module}* answered your request. You can read and answer it here.\n\nThis icon goes again when the conversation is closed.",
    de: "Der Entwickler von *{module}* hat auf deine Anfrage geantwortet. Du kannst sie hier lesen und antworten.\n\nDieses Symbol verschwindet wieder, wenn die Unterhaltung geschlossen ist.",
  },
  "inbox.gone": {
    en: "All your conversations are closed, so the inbox icon went away.\n\nYou can still read them in Settings > Account > Messages.",
    de: "Alle deine Unterhaltungen sind geschlossen, deshalb ist das Postfach-Symbol verschwunden.\n\nDu findest sie weiterhin unter Einstellungen > Konto > Nachrichten.",
  },
};

/** Fills {module}, {developer}, {days} and {reason}; a placeholder without a value is left empty, unknown ones stay as they are. */
export function fillPlaceholders(text: string, values: Partial<Record<"module" | "developer" | "days" | "reason", string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name === "module" || name === "developer" || name === "days" || name === "reason" ? (values[name] ?? "") : whole));
}

/** Plain text with blank-line paragraphs and *emphasis* as the one mark-up; everything else is shown as typed. */
export function noteParagraphs(text: string): NoteParagraphs {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) =>
      paragraph
        .split(/\*([^*]+)\*/)
        .map((part, index) => ({ text: part, em: index % 2 === 1 }))
        .filter((span) => span.text !== ""),
    );
}

/** A note's text in a language: what the admin saved, else the built-in one, with the placeholders filled in. */
export function noteText(key: NoteKey, language: Language, texts: NoteTexts | null, values: Parameters<typeof fillPlaceholders>[1]): NoteParagraphs {
  const saved = texts?.[key]?.[language]?.trim();
  return noteParagraphs(fillPlaceholders(saved || BUILT_IN_TEXTS[key][language], values));
}

/** The note key for why the icon appeared. The always-on icon of a developer has no note of its own. */
export function appearedKey(cause: Exclude<InboxCause, "developer">): NoteKey {
  return cause === "sent" ? "inbox.appeared.sent" : cause === "tavora" ? "inbox.appeared.tavora" : "inbox.appeared.developerReply";
}

// ── Reading a list ─────────────────────────────────────────────────────

/** The developer's name out of the service's English title "Developer of <module> (<name>)"; null when it has none. */
export function developerNameOf(item: Pick<ConversationItem, "title" | "module">): string | null {
  if (!item.module) return null;
  const start = `Developer of ${item.module.name} (`;
  return item.title.startsWith(start) && item.title.endsWith(")") ? item.title.slice(start.length, -1) || null : null;
}

/** Whether the inbox icon shows: an open conversation, or a published module that takes messages. */
export function inboxIcon(items: readonly ConversationItem[] | null, developer: boolean): boolean {
  return developer || (items ?? []).some((item) => item.state === "open");
}

/** Why the icon appeared for an account that is not a developer: Tavora wrote, a developer answered, or a request was sent. */
export function inboxCause(items: readonly ConversationItem[] | null, developer: boolean, justSent = false): InboxCause | null {
  const open = (items ?? []).filter((item) => item.state === "open" && item.role === "user");
  if (justSent && open.some((item) => item.kind === "developer")) return "sent";
  if (open.some((item) => item.kind === "tavora")) return "tavora";
  // Opened elsewhere (another PC) and already answered: the service marks the user's side unread then.
  if (open.some((item) => item.kind === "developer" && item.unread)) return "developerReply";
  if (open.length) return "sent";
  return developer ? "developer" : null;
}

/** Messages the user can still write to: open ones. Conversations grouped by module, newest first inside. */
export interface ConversationGroup {
  key: string;
  module: { id: string; name: string } | null;
  items: ConversationItem[];
}

/** Groups by module (Tavora's own conversations in one group at the end), the modules by name, the newest conversation first. */
export function groupConversations(items: readonly ConversationItem[]): ConversationGroup[] {
  const groups = new Map<string, ConversationGroup>();
  for (const item of items) {
    const key = item.kind === "tavora" ? "tavora" : (item.module?.id ?? "none");
    const group = groups.get(key) ?? { key, module: item.kind === "tavora" ? null : item.module, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.items.sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
  return [...groups.values()].sort((a, b) => {
    if (a.key === "tavora" || b.key === "tavora") return a.key === "tavora" ? 1 : -1;
    return (a.module?.name ?? "").localeCompare(b.module?.name ?? "");
  });
}

/** Whether a text is empty after trimming or longer than a message may be, by characters. */
export function messageProblem(text: string, max = MAX_MESSAGE_LENGTH): "empty" | "long" | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  return [...trimmed].length > max ? "long" : null;
}

/** The host of an https link for "Report a bug on github.com"; null for anything else. */
export function linkHost(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}
