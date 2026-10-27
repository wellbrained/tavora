// The user's messages: conversations with the developers of modules and with Tavora (decided 2026-10-27, "Conversations" in
// the Tavora Admin design doc). The main process talks to the service (apps/api/src/conversations.ts) with the account's
// sign-in; the host UI only sees the view built here. Nothing the service says is trusted: every conversation and
// message is checked field by field and shown as plain text. The notes about the header icon are decided here, once per
// cause, and remembered on this PC.
import { readFile } from "node:fs/promises";
import {
  appearedKey,
  CLOSE_REASONS,
  developerNameOf,
  EMPTY_INBOX,
  IDLE_DAYS,
  inboxCause,
  inboxIcon,
  linkHost,
  NOTE_KEYS,
  noteText,
  REQUEST_TYPES,
  type ContactDraft,
  type ConversationDetailResult,
  type ConversationItem,
  type ConversationMessage,
  type InboxCause,
  type InboxNote,
  type InboxView,
  type ModuleContact,
  type NoteTexts,
} from "../shared/conversations";
import { translate, type Language, type MessageKey } from "../shared/i18n";
import { writeFileAtomic } from "./fsutil";
import { UserError } from "./messages";

const TIMEOUT_MS = 10_000;
const POLL_MS = 5 * 60_000;
const TEXTS_MS = 60 * 60_000;
const MAX_ITEMS = 500;
const MAX_MESSAGES = 500;
const ID = /^[A-Za-z0-9_-]{16}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** What the service's `reason` becomes for the user. */
const REASONS: Record<string, MessageKey> = {
  "message-link": "inbox.error.link",
  "message-words": "inbox.error.words",
  "daily-limit": "inbox.error.dailyLimit",
  "account-too-new": "inbox.error.tooNew",
  blocked: "inbox.error.blocked",
  "already-open": "inbox.error.alreadyOpen",
  "contact-off": "inbox.error.contactOff",
  "own-module": "inbox.error.own",
  closed: "inbox.error.closed",
  "signed-out": "account.error.signedOut",
  "too-many": "error.catalogBusy",
  "not-found": "inbox.error.gone",
  "tavora-only": "inbox.error.tavoraOnly",
  "bad-link": "inbox.error.badLink",
  "not-publisher": "error.reviewNotPublisher",
  unavailable: "inbox.error.unavailable",
};

/** What is remembered on this PC so each note shows once. */
interface Remembered {
  /** The icon was showing at the last look. */
  iconShown: boolean;
  /** Causes whose "appeared" note was already queued. */
  appeared: InboxCause[];
  goneNoted: boolean;
  developerNoteSeen: boolean;
  /** The note waiting to be read. */
  pending: { kind: "appeared"; cause: Exclude<InboxCause, "developer">; module: string; developer: string } | { kind: "gone" } | null;
}

const fresh = (): Remembered => ({ iconShown: false, appeared: [], goneNoted: false, developerNoteSeen: false, pending: null });

export interface InboxOptions {
  baseUrl: string;
  fetch: typeof fetch;
  /** The sign-in token while signed in with online features on; otherwise null and nothing is asked. */
  token: () => string | null;
  language: () => Language;
  tavoraVersion: string;
  file: string;
  /** The version of a module installed here, if it is. */
  installedVersion: (moduleId: string) => string | undefined;
  /** Whether the account has set up developer access (a developer name). */
  isDeveloper: () => boolean;
  /** The published modules of the account (from the catalog and the account's linked keys). */
  ownModules: () => Promise<{ id: string; name: string }[]>;
  onChange: (view: InboxView) => void;
  /** Opens a developer's public link where the user picks (it leaves Tavora). */
  openLink: (url: string) => void;
  pollMs?: number;
}

const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);
const date = (value: unknown): string | null => (typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : null);

export function parseItem(raw: unknown): ConversationItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const m = (typeof r.module === "object" && r.module !== null ? r.module : null) as Record<string, unknown> | null;
  const module = m && typeof m.id === "string" && m.id.length <= 200 && typeof m.name === "string" && m.name.length <= 200 ? { id: m.id, name: m.name } : null;
  const createdAt = date(r.createdAt);
  const lastMessageAt = date(r.lastMessageAt);
  const title = text(r.title, 300);
  const label = text(r.label, 8);
  if (typeof r.id !== "string" || !ID.test(r.id) || (r.kind !== "developer" && r.kind !== "tavora") || (r.role !== "user" && r.role !== "developer")) return null;
  if (!createdAt || !lastMessageAt || title === null || label === null || (r.state !== "open" && r.state !== "closed")) return null;
  const closeReason = typeof r.closeReason === "string" && (CLOSE_REASONS as readonly string[]).includes(r.closeReason) ? (r.closeReason as ConversationItem["closeReason"]) : null;
  const closesInDays = typeof r.closesInDays === "number" && Number.isInteger(r.closesInDays) && r.closesInDays >= 1 && r.closesInDays <= 30 ? r.closesInDays : null;
  return {
    id: r.id,
    kind: r.kind,
    role: r.role,
    module,
    type: (REQUEST_TYPES as readonly unknown[]).includes(r.type) ? (r.type as ConversationItem["type"]) : null,
    label,
    title,
    state: r.state,
    closeReason,
    createdAt,
    lastMessageAt,
    closedAt: date(r.closedAt),
    unread: r.unread === true,
    previousId: typeof r.previousId === "string" && ID.test(r.previousId) ? r.previousId : null,
    closesInDays,
  };
}

export function parseMessage(raw: unknown): ConversationMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const at = date(r.at);
  const body = text(r.text, 5000);
  if (!Number.isSafeInteger(r.id) || !at || body === null || (r.from !== "user" && r.from !== "developer" && r.from !== "tavora")) return null;
  const v = (typeof r.versions === "object" && r.versions !== null ? r.versions : null) as Record<string, unknown> | null;
  const versions = v && typeof v.tavora === "string" && typeof v.module === "string" && v.tavora.length <= 64 && v.module.length <= 64 ? { tavora: v.tavora, module: v.module } : null;
  return { id: r.id as number, from: r.from, mine: r.mine === true, text: body, at, ...(versions ? { versions } : {}) };
}

function parseTexts(raw: unknown): NoteTexts {
  const texts: NoteTexts = {};
  const source = (typeof raw === "object" && raw !== null ? (raw as { texts?: unknown }).texts : null) as Record<string, unknown> | null | undefined;
  for (const key of NOTE_KEYS) {
    const entry = source?.[key] as Record<string, unknown> | undefined;
    const en = text(entry?.en, 2000);
    const de = text(entry?.de, 2000);
    if (en !== null || de !== null) texts[key] = { en: en ?? "", de: de ?? "" };
  }
  return texts;
}

export class Inbox {
  private readonly o: InboxOptions;
  private items: ConversationItem[] | null = null;
  private developer = false;
  private emailCopies: InboxView["emailCopies"] = null;
  private contacts: ModuleContact[] | null = null;
  private texts: NoteTexts | null = null;
  private textsAt = 0;
  private remembered: Remembered = fresh();
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy: Promise<void> | null = null;

  constructor(options: InboxOptions) {
    this.o = options;
  }

  async init(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.o.file, "utf8")) as Partial<Remembered>;
      this.remembered = {
        iconShown: saved.iconShown === true,
        appeared: Array.isArray(saved.appeared) ? saved.appeared.filter((cause): cause is InboxCause => ["sent", "tavora", "developerReply", "developer"].includes(cause as string)) : [],
        goneNoted: saved.goneNoted === true,
        developerNoteSeen: saved.developerNoteSeen === true,
        pending: parsePending(saved.pending),
      };
    } catch {
      // Nothing remembered yet.
    }
    this.loaded = true;
    this.timer = setInterval(() => void this.refresh(), this.o.pollMs ?? POLL_MS);
    this.timer.unref?.();
    void this.refresh();
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  /** The signed-in account changed (in or out). */
  accountChanged(signedIn: boolean): void {
    if (!signedIn) {
      this.items = null;
      this.developer = false;
      this.emailCopies = null;
      this.contacts = null;
      this.remembered.iconShown = false;
      this.remembered.pending = null;
      this.changed();
    }
    if (signedIn && this.loaded) void this.refresh();
  }

  view(): InboxView {
    if (!this.o.token()) return { ...EMPTY_INBOX };
    const items = this.items;
    const icon = inboxIcon(items, this.developer);
    const cause = icon ? inboxCause(items, this.developer) : null;
    const first = (items ?? []).find((item) => item.kind === "developer" && item.role === "user" && item.state === "open");
    const language = this.o.language();
    const values = { module: first?.module?.name ?? "", developer: (first && developerNameOf(first)) ?? "", days: String(IDLE_DAYS) };
    const note = this.remembered.pending;
    return {
      active: true,
      items,
      developer: this.developer,
      icon,
      unread: (items ?? []).filter((item) => item.unread).length,
      cause,
      why: cause && cause !== "developer" ? noteText(appearedKey(cause), language, this.texts, values) : null,
      note: note ? this.noteView(note, language) : null,
      emailCopies: this.emailCopies,
      developerNote: (this.o.isDeveloper() || this.developer) && !this.remembered.developerNoteSeen,
      contacts: this.contacts,
    };
  }

  private noteView(note: NonNullable<Remembered["pending"]>, language: Language): InboxNote {
    if (note.kind === "gone") return { kind: "gone", paragraphs: noteText("inbox.gone", language, this.texts, {}) };
    return { kind: "appeared", paragraphs: noteText(appearedKey(note.cause), language, this.texts, { module: note.module, developer: note.developer, days: String(IDLE_DAYS) }) };
  }

  private changed(): void {
    this.o.onChange(this.view());
  }

  private async save(): Promise<void> {
    if (this.loaded) await writeFileAtomic(this.o.file, JSON.stringify(this.remembered)).catch(() => undefined);
  }

  // ── Reading ────────────────────────────────────────────────────────────

  /** Reads the conversations, the email switch and (now and then) the editable texts. Quietly; offline keeps what was shown. */
  refresh(justSent = false): Promise<void> {
    this.busy ??= this.read(justSent).finally(() => (this.busy = null));
    return this.busy;
  }

  private async read(justSent: boolean): Promise<void> {
    if (!this.o.token()) {
      this.changed();
      return;
    }
    try {
      const list = await this.request("GET", "/v1/conversations");
      const raw = Array.isArray(list.conversations) ? list.conversations.slice(0, MAX_ITEMS) : [];
      this.items = raw.map(parseItem).filter((item): item is ConversationItem => item !== null);
      const inbox = (typeof list.inbox === "object" && list.inbox !== null ? list.inbox : {}) as Record<string, unknown>;
      this.developer = inbox.developer === true;
      const settings = await this.request("GET", "/v1/conversations/settings").catch(() => null);
      if (settings) this.emailCopies = { on: settings.emailCopies === true, hasEmail: settings.hasEmail === true };
      if (Date.now() - this.textsAt > TEXTS_MS) await this.readTexts();
    } catch {
      this.changed();
      return;
    }
    this.notes(justSent);
    this.changed();
    await this.save();
  }

  private async readTexts(): Promise<void> {
    try {
      const response = await this.o.fetch(`${this.o.baseUrl}/v1/texts`, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return;
      this.texts = parseTexts(await response.json().catch(() => null));
      this.textsAt = Date.now();
    } catch {
      // The built-in texts do.
    }
  }

  /** Decides the note for an icon that just appeared or went away (once per cause). */
  private notes(justSent: boolean): void {
    const icon = inboxIcon(this.items, this.developer);
    const r = this.remembered;
    if (icon && !r.iconShown) {
      const cause = inboxCause(this.items, this.developer, justSent);
      if (cause && cause !== "developer" && !r.appeared.includes(cause)) {
        const first = (this.items ?? []).find((item) => item.kind === "developer" && item.role === "user" && item.state === "open");
        r.appeared.push(cause);
        r.pending = { kind: "appeared", cause, module: first?.module?.name ?? "", developer: (first && developerNameOf(first)) ?? "" };
      }
    } else if (!icon && r.iconShown && (this.items ?? []).length > 0 && !r.goneNoted) {
      r.goneNoted = true;
      r.pending = { kind: "gone" };
    }
    r.iconShown = icon;
  }

  async noteSeen(): Promise<void> {
    this.remembered.pending = null;
    this.changed();
    await this.save();
  }

  async developerNoteSeen(): Promise<void> {
    this.remembered.developerNoteSeen = true;
    this.changed();
    await this.save();
  }

  /** One conversation with its messages; reading it marks it read on the service. */
  async conversation(id: string): Promise<ConversationDetailResult> {
    if (!ID.test(id)) return { status: "error", error: this.say("inbox.error.gone") };
    try {
      const body = await this.request("GET", `/v1/conversations/${id}`);
      const detail = this.detail(body);
      void this.refresh();
      return detail ?? { status: "error", error: this.say("error.generic") };
    } catch (error) {
      return { status: "error", error: this.errorText(error) };
    }
  }

  private detail(body: Record<string, unknown>): ConversationDetailResult | null {
    const conversation = parseItem(body.conversation);
    if (!conversation) return null;
    const messages = (Array.isArray(body.messages) ? body.messages.slice(0, MAX_MESSAGES) : []).map(parseMessage).filter((m): m is ConversationMessage => m !== null);
    return { status: "ok", conversation, messages };
  }

  private say(key: MessageKey): string {
    return translate(this.o.language(), key);
  }

  private errorText(error: unknown): string {
    return error instanceof UserError ? translate(this.o.language(), error.key, error.params) : this.say("error.generic");
  }

  /** What Contact the developer needs before the dialog opens. */
  async contactDraft(moduleId: string): Promise<ContactDraft> {
    if (!this.o.token()) return { status: "signed-out" };
    try {
      const body = await this.request("GET", `/v1/catalog/modules/${encodeURIComponent(moduleId)}`, undefined, false);
      const module = (typeof body.module === "object" && body.module !== null ? body.module : {}) as Record<string, unknown>;
      const name = text(module.name, 200) ?? moduleId;
      const contact = (typeof module.contact === "object" && module.contact !== null ? module.contact : { enabled: true, link: null }) as Record<string, unknown>;
      if (contact.enabled === false) {
        const link = typeof contact.link === "string" && linkHost(contact.link) ? contact.link : null;
        return { status: "off", moduleName: name, link, host: linkHost(link) };
      }
      const version = this.o.installedVersion(moduleId) ?? (typeof module.version === "string" && SEMVER.test(module.version) ? module.version : null);
      if (!version) return { status: "error", error: this.say("error.generic") };
      return { status: "ok", moduleName: name, versions: { tavora: this.o.tavoraVersion, module: version } };
    } catch (error) {
      return { status: "error", error: this.errorText(error) };
    }
  }

  /** Opens the developer's public link after a click; the address is read from the service again. */
  async openContactLink(moduleId: string): Promise<void> {
    const draft = await this.contactDraft(moduleId);
    if (draft.status !== "off" || !draft.link) throw new UserError("inbox.error.contactOff");
    this.o.openLink(draft.link);
  }

  // ── Writing ────────────────────────────────────────────────────────────

  async sendRequest(moduleId: string, type: string, body: string, previousId?: string): Promise<string> {
    const draft = await this.contactDraft(moduleId);
    if (draft.status === "signed-out") throw new UserError("account.error.signedOut");
    if (draft.status === "off") throw new UserError("inbox.error.contactOff");
    if (draft.status !== "ok") throw new UserError("error.generic");
    const answer = await this.request("POST", "/v1/conversations", { moduleId, type, text: body.trim(), versions: draft.versions, ...(previousId ? { previousId } : {}) });
    const detail = this.detail(answer);
    await this.refresh(true);
    if (detail?.status !== "ok") throw new UserError("error.generic");
    return detail.conversation.id;
  }

  async reply(id: string, body: string): Promise<void> {
    await this.request("POST", `/v1/conversations/${id}/messages`, { text: body.trim() });
    void this.refresh();
  }

  async close(id: string, outcome?: string): Promise<void> {
    await this.request("POST", `/v1/conversations/${id}/close`, outcome === undefined ? {} : { outcome });
    await this.refresh();
  }

  async block(id: string, report: { reason: string; note: string | null } | null): Promise<void> {
    await this.request("POST", `/v1/conversations/${id}/block`, report ? { report: reportBody(report) } : {});
    await this.refresh();
  }

  async report(id: string, report: { reason: string; note: string | null }): Promise<void> {
    await this.request("POST", `/v1/conversations/${id}/report`, reportBody(report));
  }

  async delete(id: string): Promise<void> {
    await this.request("DELETE", `/v1/conversations/${id}`);
    await this.refresh();
  }

  async setEmailCopies(on: boolean): Promise<void> {
    const answer = await this.request("PUT", "/v1/conversations/settings", { emailCopies: on });
    this.emailCopies = { on: answer.emailCopies === true, hasEmail: answer.hasEmail === true };
    this.changed();
  }

  /** The contact settings of the account's published modules (Settings > Development). */
  async loadContacts(): Promise<void> {
    if (!this.o.token() || !(this.o.isDeveloper() || this.developer)) return;
    try {
      const own = (await this.o.ownModules()).slice(0, 100);
      const contacts: ModuleContact[] = [];
      for (const module of own) {
        const answer = await this.request("GET", `/v1/catalog/modules/${encodeURIComponent(module.id)}/contact`).catch(() => null);
        if (!answer) continue;
        const link = typeof answer.link === "string" && linkHost(answer.link) ? answer.link : null;
        contacts.push({ id: module.id, name: module.name, enabled: answer.enabled !== false, link });
      }
      this.contacts = contacts;
      this.changed();
    } catch {
      // Offline: the list stays as it was.
    }
  }

  async setContact(moduleId: string, enabled: boolean, link: string | null): Promise<void> {
    const answer = await this.request("PUT", `/v1/catalog/modules/${encodeURIComponent(moduleId)}/contact`, { enabled, link: link?.trim() || null });
    const saved = typeof answer.link === "string" ? answer.link : null;
    this.contacts = (this.contacts ?? []).map((contact) => (contact.id === moduleId ? { ...contact, enabled: answer.enabled !== false, link: saved } : contact));
    this.changed();
    void this.refresh();
  }

  // ── The service ────────────────────────────────────────────────────────

  /** One JSON request, signed in. Throws a UserError the user can read. */
  private async request(method: string, pathname: string, body?: unknown, auth = true): Promise<Record<string, unknown>> {
    const token = this.o.token();
    if (auth && !token) throw new UserError("account.error.signedOut");
    let response: Response;
    try {
      response = await this.o.fetch(`${this.o.baseUrl}${pathname}`, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        method,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new UserError("error.catalogUnreachable");
    }
    if (response.status === 204) return {};
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok) return json && typeof json === "object" && !Array.isArray(json) ? json : {};
    const key = typeof json?.reason === "string" ? REASONS[json.reason] : undefined;
    if (key) throw new UserError(key, Number.isInteger(json?.hours) && (json!.hours as number) > 0 ? { hours: json!.hours as number } : undefined);
    if (response.status === 404) throw new UserError("inbox.error.gone");
    if (response.status === 401) throw new UserError("account.error.signedOut");
    if (response.status === 503) throw new UserError("inbox.error.unavailable");
    if (response.status === 429) throw new UserError("error.catalogBusy");
    throw new UserError("error.generic");
  }
}

function reportBody(report: { reason: string; note: string | null }): Record<string, unknown> {
  return { reason: report.reason, ...(report.note?.trim() ? { note: report.note.trim() } : {}) };
}

function parsePending(value: unknown): Remembered["pending"] {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "gone") return { kind: "gone" };
  if (v.kind === "appeared" && (v.cause === "sent" || v.cause === "tavora" || v.cause === "developerReply") && typeof v.module === "string" && v.module.length <= 200) {
    return { kind: "appeared", cause: v.cause, module: v.module, developer: typeof v.developer === "string" ? v.developer.slice(0, 100) : "" };
  }
  return null;
}
