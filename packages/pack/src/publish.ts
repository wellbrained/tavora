// Publishes a packed module to Tavora's module catalog. The zip must be signed with this key (the
// pack command does that), and the key must be linked to your Tavora account (Tavora links the keys it
// keeps; a key file is linked with `tavora-pack link`). Besides the zip, a signature over its SHA-256 is
// sent, and the account's sign-in (Tavora's Publish button) or a publish token (CI): the key alone
// publishes nothing (decided 2026-10-20). The secret key never leaves this PC.
import { createHash, sign, type KeyObject } from "node:crypto";
import { apiReason, type ApiReason } from "@tavora/module-schema";
import { DEFAULT_API_URL } from "./link.ts";
import { verifyFiles } from "./signature.ts";
import { asSigner, type Signer } from "./signer.ts";
import { readZip, ZipError } from "./zip.ts";

/** What is signed: this line, then the zip's SHA-256 in hex. Nothing else Tavora signs starts like it. */
export const PUBLISH_STATEMENT = "tavora-catalog-publish-1";

export class PublishError extends Error {}

/** Where to read what is not allowed in the catalog; linked from what `tavora-pack publish` prints. */
export const CATALOG_RULES_URL = "https://docs.mytavora.app/guide/catalog-rules";

/**
 * What the catalog did with the upload: it `published` it (listed at once), or it is `waiting` for a person at Tavora to look
 * at it first (review before listing, decided 2026-10-26). A waiting version is not listed, and `reasons` say why.
 */
export interface Published {
  id: string;
  version: string;
  sha256: string;
  status: "published" | "waiting";
  reasons: { check: string; text: string }[];
}

/** The signature (base64) the service checks: this key over the publish statement for these bytes. */
export function publishSignature(key: KeyObject, zip: Buffer): string {
  const sha256 = createHash("sha256").update(zip).digest("hex");
  return sign(null, Buffer.from(`${PUBLISH_STATEMENT}\n${sha256}`, "utf8"), key).toString("base64");
}

/** The API's reasons, and "token-not-working", which tavora-pack words for a refused publish token. */
const MESSAGES: Partial<Record<ApiReason | "token-not-working", string>> = {
  "sign-in-needed": "Publishing needs your Tavora account. Publish from Tavora (Settings > Development), or from CI with a publish token in TAVORA_PUBLISH_TOKEN (Settings > Development > Publisher keys and CI).",
  "token-not-working": "This publish token doesn't work any more: it was removed or ran out. Make a new one in Tavora (Settings > Development > Publisher keys and CI).",
  "wrong-account": "This publisher key is linked to another Tavora account than the one publishing.",
  "token-new-prefix": "A publish token publishes only under id prefixes your account has. Publish this module's first version from Tavora.",
  "key-not-linked": "Your publisher key is not linked to a Tavora account yet. Get a link code in Tavora (Settings > Development > Publisher keys and CI) and run tavora-pack link <code> --key <file>",
  "prefix-taken": "Another developer publishes under this id prefix. Give your module an id with a prefix of your own, such as <your name>.<module>.",
  "prefix-reserved": "This id prefix is reserved. Give your module an id with a prefix of your own, such as <your name>.<module>.",
  "too-many-prefixes": "Your account already publishes under 3 id prefixes. Use one of them for this module.",
  "daily-limit": "Your account has published as many versions as it can today. Try again tomorrow.",
  "account-full": "Your modules take as much room in the catalog as an account may have.",
  "catalog-full": "The catalog has no room right now. Tavora has been told; try again later.",
  "too-many": "Too many uploads from this connection. Wait a while and try again.",
  "too-big": "The zip is too big for the catalog.",
  banned: `This account can't publish to the catalog any more. Check your email for why. What's not allowed: ${CATALOG_RULES_URL}`,
  declined: "Tavora declined this exact zip. Fix the problem and publish a new version.",
  "too-many-waiting": "As many of your versions are waiting for review as an account may have. Wait for them, or withdraw one with tavora-pack withdraw.",
  unavailable: "Publishing is not available right now.",
};

/** Publishes the zip. Resolves with the id, version and hash the catalog now lists. */
export async function publishZip(options: {
  key: KeyObject | Signer;
  zip: Buffer;
  /** A publish token, or the account's sign-in when Tavora uploads. */
  token?: string | undefined;
  /** The language of the email the account gets about it ("en" or "de"). */
  language?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}): Promise<Published> {
  // Checked here first, so a zip signed with another key fails with a clear message before any upload.
  let verified;
  try {
    verified = verifyFiles(readZip(options.zip));
  } catch (error) {
    if (error instanceof ZipError) throw new PublishError(`That is not a module zip tavora-pack can read: ${error.message}.`);
    throw error;
  }
  if (!verified.ok) throw new PublishError(`The zip was refused: ${verified.reason}.`);
  if (!verified.signed) throw new PublishError("The zip is not signed. Pack it with tavora-pack, which signs it with your publisher key.");
  const signer = asSigner(options.key);
  if (verified.owner !== signer.fingerprint) throw new PublishError("The zip was signed with another publisher key. Publish it with the key that packed it.");
  if (!options.token) throw new PublishError(MESSAGES["sign-in-needed"]!);
  const sha256 = createHash("sha256").update(options.zip).digest("hex");
  const signature = (await signer.signPublish(options.zip, sha256)).toString("base64");

  const url = `${(options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")}/v1/catalog/publish`;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        Accept: "application/json",
        "X-Tavora-Signature": signature,
        Authorization: `Bearer ${options.token}`,
        ...(options.language ? { "Accept-Language": options.language } : {}),
      },
      body: new Uint8Array(options.zip),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new PublishError(`Tavora's service could not be reached (${url}). Check your internet connection.`);
  }
  const answer = (await response.json().catch(() => ({}))) as { reason?: unknown; error?: unknown; id?: unknown; version?: unknown; sha256?: unknown; status?: unknown; reasons?: unknown };
  if (!response.ok) {
    // A token was sent, so it is the token that doesn't work.
    const sent = apiReason(answer);
    const known = sent === undefined ? undefined : MESSAGES[sent === "sign-in-needed" ? "token-not-working" : sent];
    // "invalid" and "conflict" carry the service's own sentence about this zip.
    throw new PublishError(known ?? (typeof answer.error === "string" ? answer.error : `The service refused the upload (${response.status}).`));
  }
  if (typeof answer.id !== "string" || typeof answer.version !== "string" || typeof answer.sha256 !== "string") throw new PublishError("The service gave an answer tavora-pack does not understand.");
  const reasons = (Array.isArray(answer.reasons) ? answer.reasons : [])
    .filter((item): item is { check: string; text: string } => typeof item === "object" && item !== null && typeof (item as { check?: unknown }).check === "string" && typeof (item as { text?: unknown }).text === "string")
    .map(({ check, text }) => ({ check, text }));
  // Anything but a plain "published" answer is not listed yet.
  return { id: answer.id, version: answer.version, sha256: answer.sha256, status: answer.status === "waiting" ? "waiting" : "published", reasons };
}

/** Takes back a version that waits for review (its zip's SHA-256). Resolves with what was withdrawn. */
export async function withdrawVersion(options: { token: string | undefined; sha256: string; apiUrl?: string; fetch?: typeof fetch }): Promise<{ id: string; version: string }> {
  if (!options.token) throw new PublishError(MESSAGES["sign-in-needed"]!);
  if (!/^[0-9a-f]{64}$/.test(options.sha256)) throw new PublishError("Give the zip's SHA-256 (64 letters and digits), or the zip file.");
  const url = `${(options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")}/v1/catalog/waiting/${options.sha256}`;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, { method: "DELETE", headers: { Accept: "application/json", Authorization: `Bearer ${options.token}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new PublishError(`Tavora's service could not be reached (${url}). Check your internet connection.`);
  }
  const answer = (await response.json().catch(() => ({}))) as { reason?: unknown; id?: unknown; version?: unknown };
  if (response.ok && typeof answer.id === "string" && typeof answer.version === "string") return { id: answer.id, version: answer.version };
  if (apiReason(answer) === "not-waiting") throw new PublishError("None of your versions with this hash is waiting for review.");
  if (apiReason(answer) === "sign-in-needed") throw new PublishError(MESSAGES["token-not-working"]!);
  throw new PublishError(`The service refused the request (${response.status}).`);
}
