import { Hono } from "hono";
import type { AccountStore } from "./account-store.ts";
import type { CatalogStore } from "./catalog.ts";
import {
  ABOUT_TYPES,
  accountName,
  cleanMessage,
  MAX_MESSAGE_LENGTH,
  placeholdersOk,
  TEXT_KEYS,
  TEXT_PLACEHOLDERS,
  type About,
  type Conversation,
  type ConversationNotifier,
  type ConversationStore,
} from "./conversations.ts";

/**
 * The admin side of conversations (decided 2026-10-27), as JSON under `/api/messages/*` and `/api/texts` of the admin app (the
 * token check there covers it, and every POST lands in the Activity log). The admin reads only the conversations it is part of
 * (Tavora conversations) and the reported ones: any other conversation answers 403, so the privacy text can say so. Tavora
 * writes plain text and may include links; there are no limits on it.
 */

const ID = /^[A-Za-z0-9_-]{16}$/;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MODULE_ID = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*){1,4}$/;
const MAX_ABOUT_ID = 100;
const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());

export interface ConversationsAdminOptions {
  conversations: ConversationStore;
  accounts: AccountStore;
  catalog?: CatalogStore | undefined;
  /** Sends the email copy to the account. Absent: none is sent. */
  notifier?: ConversationNotifier | undefined;
  now?: (() => number) | undefined;
}

const json = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = JSON.parse(await request.text()) as unknown;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export function conversationsAdminRoutes({ conversations, accounts, catalog, notifier, now = Date.now }: ConversationsAdminOptions) {
  const app = new Hono();

  const person = (id: string | null) => (id ? { accountId: id, name: accountName(accounts, id), email: accounts.account(id)?.email ?? null } : null);
  const summary = (conversation: Conversation) => ({
    id: conversation.id,
    kind: conversation.kind,
    module: conversation.moduleId ? { id: conversation.moduleId, name: conversation.moduleName ?? conversation.moduleId } : null,
    type: conversation.type,
    label: conversation.label,
    state: conversation.state,
    closeReason: conversation.closeReason,
    createdAt: iso(conversation.createdAt),
    lastMessageAt: iso(conversation.lastMessageAt),
    closedAt: iso(conversation.closedAt),
    about: conversation.about,
    // Unread for Tavora: only a Tavora conversation has a Tavora side.
    unread: conversation.kind === "tavora" && conversations.unread(conversation, "other"),
    user: person(conversation.userAccountId),
    developer: conversation.kind === "developer" ? person(conversation.developerAccountId) : null,
    reports: conversations.reports(conversation.id).map((report) => ({
      accountId: report.reporterAccountId,
      name: accountName(accounts, report.reporterAccountId),
      side: report.reporterAccountId === conversation.userAccountId ? "user" : "developer",
      reason: report.reason,
      note: report.note,
      at: iso(report.at),
    })),
  });
  const messages = (conversation: Conversation) =>
    conversations.messages(conversation.id).map((message) => ({ id: message.id, from: message.from, text: message.text, at: iso(message.createdAt), ...(message.versions ? { versions: message.versions } : {}) }));
  const full = (conversation: Conversation) => ({ ...summary(conversation), messages: messages(conversation) });

  // Tavora's own conversations, and the reported ones with everything in them.
  app.get("/", (context) =>
    context.json({
      conversations: conversations.tavoraConversations().map(summary),
      reported: conversations.reportedConversations().map(full),
    }),
  );

  /** A Tavora conversation or a reported one; anything else is not the admin's to read. */
  const readable = (id: unknown): { conversation: Conversation } | { status: 400 | 403 | 404; error: string } => {
    if (typeof id !== "string" || !ID.test(id)) return { status: 400, error: "Send { id }." };
    const conversation = conversations.get(id);
    if (!conversation) return { status: 404, error: "No such conversation." };
    if (conversation.kind !== "tavora" && conversations.reports(id).length === 0) return { status: 403, error: "This conversation is private: Tavora reads only its own and reported ones." };
    return { conversation };
  };

  // Registered before "/:id" so "start" and the like are never read as ids.
  app.post("/start", async (context) => {
    const { accountId, text: raw, about } = await json(context.req.raw);
    const text = cleanMessage(raw);
    let target: About | null = null;
    if (about !== undefined && about !== null) {
      const value = about as Record<string, unknown>;
      if (typeof value !== "object" || !(ABOUT_TYPES as readonly unknown[]).includes(value.type) || typeof value.id !== "string" || !value.id || value.id.length > MAX_ABOUT_ID) {
        return context.json({ error: `Send about as { type: one of ${ABOUT_TYPES.join(", ")}, id }.` }, 400);
      }
      target = { type: value.type as About["type"], id: value.id };
    }
    if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId) || typeof text !== "string") return context.json({ error: `Send { accountId, text: 1 to ${MAX_MESSAGE_LENGTH} characters, about? }.` }, 400);
    if (!accounts.account(accountId)) return context.json({ error: "No such account." }, 404);
    const moduleId = target?.type === "module-report" && MODULE_ID.test(target.id) ? target.id : null;
    const conversation = conversations.startTavora({ userAccountId: accountId, text, about: target, moduleId, moduleName: moduleId ? (catalog?.module(moduleId)?.module.name ?? moduleId) : null }, now());
    void notifier?.message(conversation, "tavora", text, true).catch(() => undefined);
    return context.json({ ok: true, id: conversation.id });
  });

  app.post("/reply", async (context) => {
    const { id, text: raw } = await json(context.req.raw);
    const text = cleanMessage(raw);
    if (typeof id !== "string" || !ID.test(id) || typeof text !== "string") return context.json({ error: `Send { id, text: 1 to ${MAX_MESSAGE_LENGTH} characters }.` }, 400);
    const conversation = conversations.get(id);
    if (!conversation) return context.json({ error: "No such conversation." }, 404);
    if (conversation.kind !== "tavora") return context.json({ error: "Tavora writes only in its own conversations. Start one with the account instead." }, 403);
    if (conversation.state !== "open") return context.json({ error: "This conversation is closed. Reopen it first." }, 409);
    if (!conversation.userAccountId) return context.json({ error: "This person left." }, 409);
    conversations.addMessage(id, "tavora", null, text, now());
    conversations.markRead(id, "other");
    void notifier?.message(conversation, "tavora", text, false).catch(() => undefined);
    return context.json({ ok: true });
  });

  app.post("/close", async (context) => {
    const { id } = await json(context.req.raw);
    const found = readable(id);
    if ("error" in found) return context.json({ error: found.error }, found.status);
    return conversations.closeConversation(found.conversation.id, "tavora", now()) ? context.json({ ok: true }) : context.json({ error: "This conversation is already closed." }, 409);
  });

  app.post("/reopen", async (context) => {
    const { id } = await json(context.req.raw);
    if (typeof id !== "string" || !ID.test(id)) return context.json({ error: "Send { id }." }, 400);
    const conversation = conversations.get(id);
    if (!conversation) return context.json({ error: "No such conversation." }, 404);
    if (conversation.kind !== "tavora") return context.json({ error: "Only Tavora's own conversations reopen." }, 403);
    return conversations.reopen(id, now()) ? context.json({ ok: true }) : context.json({ error: "This conversation is not closed." }, 409);
  });

  app.post("/dismiss-report", async (context) => {
    const { id } = await json(context.req.raw);
    if (typeof id !== "string" || !ID.test(id)) return context.json({ error: "Send { id }." }, 400);
    return conversations.dismissReports(id) ? context.json({ ok: true }) : context.json({ error: "No such report." }, 404);
  });

  // One conversation, only if it is Tavora's or reported. Reading a Tavora conversation marks Tavora's side read.
  app.get("/:id", (context) => {
    const found = readable(context.req.param("id"));
    if ("error" in found) return context.json({ error: found.error }, found.status);
    if (found.conversation.kind === "tavora") conversations.markRead(found.conversation.id, "other");
    return context.json(full(found.conversation));
  });

  return app;
}

const TEXT_MAX = 2000;

/** The editable texts at `/api/texts`: the keys with what is saved, and the allowed placeholders. */
export function textsAdminRoutes({ conversations }: { conversations: ConversationStore }) {
  const app = new Hono();

  app.get("/", (context) => context.json({ keys: TEXT_KEYS, placeholders: TEXT_PLACEHOLDERS, texts: conversations.texts() }));

  app.post("/", async (context) => {
    const { key, en, de } = await json(context.req.raw);
    const clean = (value: unknown) => (value === undefined || value === null ? "" : typeof value === "string" ? cleanMessage(value, TEXT_MAX) : undefined);
    const english = clean(en);
    const german = clean(de);
    if (typeof key !== "string" || !(TEXT_KEYS as readonly string[]).includes(key) || english === undefined || german === undefined) {
      return context.json({ error: `Send { key: one of ${TEXT_KEYS.join(", ")}, en, de } with plain text of at most ${TEXT_MAX} characters each.` }, 400);
    }
    const [english_, german_] = [english ?? "", german ?? ""];
    if (!placeholdersOk(english_) || !placeholdersOk(german_)) {
      return context.json({ error: `Only these placeholders are allowed: ${TEXT_PLACEHOLDERS.map((name) => `{${name}}`).join(", ")}.`, reason: "placeholder" }, 400);
    }
    conversations.setText(key, english_, german_);
    return context.json({ ok: true, texts: conversations.texts() });
  });

  return app;
}
