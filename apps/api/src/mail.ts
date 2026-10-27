import { Hono } from "hono";

/**
 * How the service sends email. A provider is chosen just before accounts go
 * live (decided 2026-10-16); until then development and tests use the test
 * inbox below, and a service without a mailer keeps accounts off.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** The provider refused because the day's allowance is used up. */
export class MailLimitError extends Error {
  constructor() {
    super("The daily email allowance is used up.");
    this.name = "MailLimitError";
  }
}

// ── Brevo ────────────────────────────────────────────────────────────────

export const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * Sends through Brevo's transactional API (decided 2026-10-16: the free plan,
 * about 300 a day). Plain text only, no tracking (switched off in the Brevo
 * account), nothing about the user but the address and the mail itself.
 */
export function createBrevoMailer(options: { apiKey: string; from: string; fetch?: typeof fetch; timeoutMs?: number }): Mailer {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async send(mail) {
      const response = await fetchImpl(BREVO_URL, {
        method: "POST",
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        headers: { "api-key": options.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: { name: "Tavora", email: options.from }, to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text }),
      });
      if (response.ok) return;
      const text = await response.text().catch(() => "");
      // Brevo says "not enough credits" (or answers 402/429) when the plan's allowance is used up.
      if (response.status === 402 || response.status === 429 || /credit|limit|quota/i.test(text)) throw new MailLimitError();
      // Never the key or the address in a log line: only the status.
      throw new Error(`Brevo answered ${response.status}`);
    },
  };
}

export type MailLanguage = "en" | "de";

export const mailLanguage = (input: unknown): MailLanguage => (input === "de" ? "de" : "en");

export type CodeMailKind = "sign-in" | "create" | "change-email" | "remove-email" | "connect-discord" | "remove-discord" | "delete";

const CODE_TEXTS: Record<MailLanguage, Record<CodeMailKind, { subject: string; lead: string }>> = {
  en: {
    "sign-in": { subject: "Your Tavora sign-in code", lead: "Here is your code to sign in to Tavora:" },
    create: { subject: "Your Tavora code", lead: "Here is your code to create a Tavora account:" },
    "change-email": { subject: "Confirm your new email for Tavora", lead: "Here is your code to use this address for your Tavora account:" },
    "remove-email": { subject: "Confirm removing your email from Tavora", lead: "Here is your code to remove this address from your Tavora account, which then signs in with Discord only:" },
    "connect-discord": { subject: "Confirm connecting Discord to Tavora", lead: "Here is your code to connect a Discord login to your Tavora account, as a second way to sign in:" },
    "remove-discord": { subject: "Confirm disconnecting Discord from Tavora", lead: "Here is your code to disconnect Discord from your Tavora account, which then signs in with this address only:" },
    delete: { subject: "Confirm deleting your Tavora account", lead: "Here is your code to delete your Tavora account:" },
  },
  de: {
    "sign-in": { subject: "Dein Tavora-Anmeldecode", lead: "Hier ist dein Code für die Anmeldung bei Tavora:" },
    create: { subject: "Dein Tavora-Code", lead: "Hier ist dein Code, um ein Tavora-Konto zu erstellen:" },
    "change-email": { subject: "Bestätige deine neue E-Mail für Tavora", lead: "Hier ist dein Code, um diese Adresse für dein Tavora-Konto zu verwenden:" },
    "remove-email": { subject: "Bestätige das Entfernen deiner E-Mail bei Tavora", lead: "Hier ist dein Code, um diese Adresse aus deinem Tavora-Konto zu entfernen; es meldet sich dann nur noch mit Discord an:" },
    "connect-discord": { subject: "Bestätige das Verbinden von Discord mit Tavora", lead: "Hier ist dein Code, um einen Discord-Login als zweiten Weg zur Anmeldung mit deinem Tavora-Konto zu verbinden:" },
    "remove-discord": { subject: "Bestätige das Trennen von Discord bei Tavora", lead: "Hier ist dein Code, um Discord von deinem Tavora-Konto zu trennen; es meldet sich dann nur noch mit dieser Adresse an:" },
    delete: { subject: "Bestätige das Löschen deines Tavora-Kontos", lead: "Hier ist dein Code, um dein Tavora-Konto zu löschen:" },
  },
};

const CODE_FOOTER: Record<MailLanguage, string> = {
  en: "It works for 10 minutes. If you did not ask for it, ignore this email: nothing happens without the code.",
  de: "Er gilt 10 Minuten. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail: Ohne den Code passiert nichts.",
};

export function codeMail(kind: CodeMailKind, to: string, code: string, language: MailLanguage): Mail {
  const { subject, lead } = CODE_TEXTS[language][kind];
  return { to, subject, text: `${lead}\n\n    ${code}\n\n${CODE_FOOTER[language]}\n\nTavora\n` };
}

/** Shows enough of an address to recognise it, not enough to learn it: n•••@example.com. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** Sent to the old address after the email of an account was changed. */
export function emailChangedMail(to: string, newEmail: string, language: MailLanguage): Mail {
  return language === "de"
    ? {
        to,
        subject: "Die E-Mail deines Tavora-Kontos wurde geändert",
        text: `Dein Tavora-Konto verwendet jetzt ${maskEmail(newEmail)} statt dieser Adresse.\n\nWenn du das nicht warst, schreib uns an tavora.app@gmail.com.\n\nTavora\n`,
      }
    : {
        to,
        subject: "The email of your Tavora account was changed",
        text: `Your Tavora account now uses ${maskEmail(newEmail)} instead of this address.\n\nIf this was not you, write to tavora.app@gmail.com.\n\nTavora\n`,
      };
}

/** Sent when the account asked to replace a publisher key: a stolen sign-in can't do it unnoticed. */
export function keyRequestMail(to: string, fingerprint: string, leaked: boolean, language: MailLanguage): Mail {
  const key = `${fingerprint.slice(0, 16)}…`;
  return language === "de"
    ? {
        to,
        subject: leaked ? "Du hast einen Herausgeberschlüssel als geleakt gemeldet" : "Du willst einen Herausgeberschlüssel ersetzen",
        text: `In Tavora hast du gebeten, deinen Herausgeberschlüssel ${key} zu ersetzen${leaked ? ", weil er geleakt wurde" : ""}. Tavora prüft das und gibt dir Bescheid in der App.\n\nWenn du das nicht warst, schreib uns an tavora.app@gmail.com.\n\nTavora\n`,
      }
    : {
        to,
        subject: leaked ? "You reported a publisher key as leaked" : "You asked to replace a publisher key",
        text: `In Tavora, you asked to replace your publisher key ${key}${leaked ? " because it was leaked" : ""}. Tavora checks it, and the app shows when it's done.\n\nIf this wasn't you, write to tavora.app@gmail.com.\n\nTavora\n`,
      };
}

/** After every publish (decided 2026-10-20), so a developer notices one they didn't make. */
export function publishedMail(to: string, module: { id: string; name: string; version: string }, fingerprint: string, token: string | null, language: MailLanguage): Mail {
  const key = fingerprint.slice(0, 16);
  return language === "de"
    ? {
        to,
        subject: `${module.name} ${module.version} wurde veröffentlicht`,
        text:
          `${module.name} ${module.version} (${module.id}) ist jetzt in Tavoras Modulkatalog, signiert mit deinem Herausgeberschlüssel ${key}` +
          (token === null ? ", hochgeladen aus Tavora.\n\n" : `, hochgeladen mit dem Veröffentlichungs-Token „${token}“.\n\n`) +
          "Wenn du das nicht warst, schreib uns sofort an tavora.app@gmail.com und entferne deine Tokens in Tavora: Einstellungen > Konto > Modul-Entwickler.\n\nTavora\n",
      }
    : {
        to,
        subject: `${module.name} ${module.version} was published`,
        text:
          `${module.name} ${module.version} (${module.id}) is now in Tavora's module catalog, signed with your publisher key ${key}` +
          (token === null ? ", uploaded from Tavora.\n\n" : `, uploaded with the publish token "${token}".\n\n`) +
          "If this wasn't you, write to tavora.app@gmail.com right away, and remove your tokens in Tavora: Settings > Account > Module developer.\n\nTavora\n",
      };
}

// ── Test inbox ───────────────────────────────────────────────────────────

export interface TestInbox extends Mailer {
  mails(): (Mail & { at: string })[];
  clear(): void;
}

/** Keeps "sent" mail in memory, newest first, for development and tests. Never used in production. */
export function createTestInbox(limit = 100): TestInbox {
  const mails: (Mail & { at: string })[] = [];
  return {
    async send(mail) {
      mails.unshift({ ...mail, at: new Date().toISOString() });
      mails.length = Math.min(mails.length, limit);
    },
    mails: () => mails.map((mail) => ({ ...mail })),
    clear: () => {
      mails.length = 0;
    },
  };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The test inbox as a page (`/`) and as JSON (`/mails`, DELETE empties it) on its own local port. */
export function createTestInboxApp(inbox: TestInbox) {
  const app = new Hono();
  app.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
  });
  app.get("/mails", (context) => context.json({ mails: inbox.mails() }));
  app.delete("/mails", (context) => {
    inbox.clear();
    return context.body(null, 204);
  });
  app.get("/", (context) => {
    const items = inbox
      .mails()
      .map((mail) => `<article><p><b>${escapeHtml(mail.subject)}</b><br>to ${escapeHtml(mail.to)} · ${escapeHtml(mail.at)}</p><pre>${escapeHtml(mail.text)}</pre></article>`)
      .join("");
    context.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    return context.html(
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>Tavora test inbox</title>` +
        `<style>body{font:15px system-ui;max-width:720px;margin:24px auto;padding:0 16px}article{border:1px solid #8884;border-radius:8px;padding:8px 16px;margin:12px 0}pre{font-size:15px;white-space:pre-wrap}</style>` +
        `<h1>Tavora test inbox</h1><p>Mail the local service "sent". Nothing here leaves this PC.</p>${items || "<p>No mail yet.</p>"}`,
    );
  });
  return app;
}
