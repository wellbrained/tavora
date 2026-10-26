import type { AccountStore } from "./account-store.ts";
import { MAIL_RESERVED } from "./accounts.ts";
import type { ReviewReason } from "./catalog.ts";
import { type Mail, type MailLanguage, type Mailer, mailLanguage } from "./mail.ts";

/**
 * The emails of the review before listing (decided 2026-10-26): to the developer when a version waits, is declined or the
 * account is banned, and to the maintainer when a version waits. Short and friendly, in English and German
 * (the writing rules in CLAUDE.md).
 */

/** Why a version is declined or an account banned: what the maintainer picks, and what the developer reads. */
export const DECLINE_REASONS = ["unsafe", "hateful", "adult", "spam", "broken"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
export const isDeclineReason = (value: unknown): value is DeclineReason => (DECLINE_REASONS as readonly unknown[]).includes(value);

export const REASON_LABELS: Record<MailLanguage, Record<DeclineReason, string>> = {
  en: { unsafe: "Unsafe or harmful", hateful: "Hateful content", adult: "Adult content", spam: "Spam or copy", broken: "Doesn't work" },
  de: { unsafe: "Unsicher oder schädlich", hateful: "Hasserfüllte Inhalte", adult: "Inhalte für Erwachsene", spam: "Spam oder Kopie", broken: "Funktioniert nicht" },
};

/** One line per check, for the developer of a version that waits. */
const CHECK_LINES: Record<MailLanguage, Record<string, string>> = {
  en: {
    words: "Its texts need a closer look.",
    permissions: "It asks for network access, connectors, or more than the last version.",
    copy: "It looks like another developer's module.",
    code: "Its code has parts that need a closer look.",
    virus: "The virus scan found something, or couldn't run.",
    "first-module": "It's your first module.",
    pictures: "It has a new icon or new screenshots.",
  },
  de: {
    words: "Seine Texte brauchen einen genaueren Blick.",
    permissions: "Es braucht Netzwerkzugriff, Konnektoren oder mehr als die letzte Version.",
    copy: "Es sieht aus wie das Modul von jemand anderem.",
    code: "Sein Code hat Stellen, die einen genaueren Blick brauchen.",
    virus: "Der Virenscan hat etwas gefunden oder ließ sich nicht ausführen.",
    "first-module": "Es ist dein erstes Modul.",
    pictures: "Es hat ein neues Icon oder neue Screenshots.",
  },
};

const RULES_URL = "https://docs.mytavora.app/guide/catalog-rules";
const CONTACT = "tavora.app@gmail.com";

type ModuleRef = { id: string; name: string; version: string };

/** Sent to the developer when a version waits for a person instead of listing. */
export function waitingMail(to: string, module: ModuleRef, reasons: readonly ReviewReason[], language: MailLanguage): Mail {
  const lines = [...new Set(reasons.map((reason) => CHECK_LINES[language][reason.check] ?? reason.text))].map((line) => `- ${line}`).join("\n");
  return language === "de"
    ? {
        to,
        subject: `${module.name} ${module.version} wartet auf eine Prüfung`,
        text:
          `${module.name} ${module.version} (${module.id}) ist noch nicht im Katalog. Jemand von Tavora schaut es sich zuerst an, weil:\n\n${lines}\n\n` +
          `Du musst nichts tun. Wir melden uns, sobald es drin ist oder etwas nicht passt.\n\nWas im Katalog nicht erlaubt ist: ${RULES_URL}\n\nTavora\n`,
      }
    : {
        to,
        subject: `${module.name} ${module.version} is waiting for review`,
        text:
          `${module.name} ${module.version} (${module.id}) isn't in the catalog yet. A person at Tavora looks at it first, because:\n\n${lines}\n\n` +
          `You don't need to do anything. We'll write to you when it's in, or if something's wrong.\n\nWhat's not allowed in the catalog: ${RULES_URL}\n\nTavora\n`,
      };
}

/** Sent to the maintainer when a version waits, with every reason and what helps judge it. */
export function waitingNoticeMail(to: string, module: ModuleRef, developer: string, reasons: readonly ReviewReason[]): Mail {
  const lines = reasons.map((reason) => `- ${reason.text}${reason.detail ? `\n    ${reason.detail}` : ""}`).join("\n");
  return {
    to,
    subject: `Waiting for review: ${module.name} ${module.version}`,
    text: `${module.name} ${module.version} (${module.id}) by ${developer} waits for approval.\n\n${lines}\n\nApprove or decline it on the review page (Approval).\n\nTavora\n`,
  };
}

function reasonBlock(reason: DeclineReason, note: string | null, language: MailLanguage): string {
  return `${language === "de" ? "Grund" : "Reason"}: ${REASON_LABELS[language][reason]}${note ? `\n${note}` : ""}`;
}

/** Sent to the developer when a version is declined. It is never listed. */
export function declinedMail(to: string, module: ModuleRef, reason: DeclineReason, note: string | null, language: MailLanguage): Mail {
  return language === "de"
    ? {
        to,
        subject: `${module.name} ${module.version} kommt nicht in den Katalog`,
        text:
          `Wir haben uns ${module.name} ${module.version} (${module.id}) angesehen und nehmen es nicht in den Katalog auf.\n\n${reasonBlock(reason, note, language)}\n\n` +
          `Diese Version wird nie gelistet. Wenn das Problem behoben ist, kannst du eine neue Version veröffentlichen.\n\nWas im Katalog nicht erlaubt ist: ${RULES_URL}\nDenkst du, das ist ein Fehler? Schreib uns an ${CONTACT}.\n\nTavora\n`,
      }
    : {
        to,
        subject: `${module.name} ${module.version} won't be in the catalog`,
        text:
          `We looked at ${module.name} ${module.version} (${module.id}) and won't add it to the catalog.\n\n${reasonBlock(reason, note, language)}\n\n` +
          `This version will never be listed. Once the problem is fixed, you can publish a new version.\n\nWhat's not allowed in the catalog: ${RULES_URL}\nThink this is a mistake? Write to ${CONTACT}.\n\nTavora\n`,
      };
}

/** Sent to the developer when the account is banned. */
export function bannedMail(to: string, reason: DeclineReason, note: string | null, language: MailLanguage): Mail {
  return language === "de"
    ? {
        to,
        subject: "Dein Konto kann nicht mehr im Tavora-Katalog veröffentlichen",
        text:
          `Dein Entwicklerkonto kann nichts mehr im Katalog veröffentlichen, und deine Module sind dort nicht mehr gelistet. Wer sie schon installiert hat, behält sie.\n\n${reasonBlock(reason, note, language)}\n\n` +
          `Was im Katalog nicht erlaubt ist: ${RULES_URL}\nDenkst du, das ist ein Fehler? Schreib uns an ${CONTACT}.\n\nTavora\n`,
      }
    : {
        to,
        subject: "Your account can't publish to Tavora's catalog any more",
        text:
          `Your developer account can't publish to the catalog any more, and your modules are no longer listed there. Players who already installed them keep them.\n\n${reasonBlock(reason, note, language)}\n\n` +
          `What's not allowed in the catalog: ${RULES_URL}\nThink this is a mistake? Write to ${CONTACT}.\n\nTavora\n`,
      };
}

/** Sends the moderation emails: best effort, and never with the emails kept for sign-in codes (MAIL_RESERVED). */
export interface Notifier {
  /** Whether the mail went out. */
  send(mail: Mail): Promise<boolean>;
}

export function createNotifier(options: { store: AccountStore; mailer: Mailer; mailDailyLimit?: number | undefined; now?: () => number }): Notifier {
  const now = options.now ?? Date.now;
  return {
    async send(mail) {
      const day = new Date(now()).toISOString().slice(0, 10);
      if (options.mailDailyLimit !== undefined && options.store.mailsSent(day) >= Math.max(0, options.mailDailyLimit - MAIL_RESERVED)) return false;
      try {
        await options.mailer.send(mail);
        options.store.countMail(day);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export { mailLanguage };
