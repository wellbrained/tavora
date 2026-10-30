/**
 * Every refusal code the API sends as `reason` next to its `error` text.
 * The desktop app and tavora-pack read these, so a rename here is a type error there.
 * A test in apps/api keeps this list in step with what the API really sends.
 * Codes are stable words: never reuse one for something else.
 */
export const API_REASONS = [
  "account-full",
  "account-too-new",
  "already-open",
  "archive",
  "bad-email",
  "bad-id",
  "bad-link",
  "bad-name",
  "bad-request",
  "bad-signature",
  "banned",
  "blocked",
  "catalog-full",
  "closed",
  "conflict",
  "contact-off",
  "copy-changed",
  "copy-full",
  "daily-limit",
  "day-taken",
  "declined",
  "discord-connected",
  "discord-expired",
  "discord-mismatch",
  "discord-refused",
  "discord-taken",
  "discord-unreachable",
  "email-taken",
  "full",
  "gone",
  "has-icon",
  "internal",
  "invalid",
  "key-in-request",
  "key-leaked",
  "key-not-linked",
  "key-revoked",
  "key-taken",
  "last-method",
  "mail-failed",
  "message-link",
  "message-words",
  "missing-parts",
  "name-reserved",
  "name-taken",
  "name-too-soon",
  "no-copy",
  "no-developer-name",
  "no-discord",
  "no-email",
  "no-game-list",
  "no-such-profile",
  "no-vault",
  "not-allowed",
  "not-found",
  "not-now",
  "not-publisher",
  "not-shown",
  "not-steam-link",
  "not-waiting",
  "own-module",
  "placeholder",
  "prefix-reserved",
  "prefix-taken",
  "review-link",
  "review-words",
  "same-email",
  "sign-in-needed",
  "signed-out",
  "steam-unreachable",
  "steam-unreadable",
  "suspended",
  "tavora-only",
  "time",
  "token-new-prefix",
  "too-big",
  "too-many",
  "too-many-keys",
  "too-many-prefixes",
  "too-many-tokens",
  "too-many-waiting",
  "unavailable",
  "unknown",
  "unknown-board",
  "vault-changed",
  "wrong-account",
  "wrong-code",
] as const;

export type ApiReason = (typeof API_REASONS)[number];

/** True when `value` is a reason the API sends. */
export function isApiReason(value: unknown): value is ApiReason {
  return typeof value === "string" && (API_REASONS as readonly string[]).includes(value);
}

/** The `reason` of a parsed API answer, or undefined when it has none or an unknown one. */
export function apiReason(answer: unknown): ApiReason | undefined {
  const reason = typeof answer === "object" && answer !== null ? (answer as { reason?: unknown }).reason : undefined;
  return isApiReason(reason) ? reason : undefined;
}
