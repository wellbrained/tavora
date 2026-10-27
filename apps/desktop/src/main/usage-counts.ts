// Tells Tavora's service that a new app version finished downloading: only the version number, so the
// admin can chart updates per day. No cookies, no referrer, no sign-in, nothing about the user or the
// PC. Only called while Online features are on. Never throws.
import { DEFAULT_API_URL } from "./online";

const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

export async function countAppUpdate(options: { baseUrl?: string; fetchImpl?: typeof fetch }, version: string): Promise<void> {
  if (!VERSION.test(version)) return;
  const base = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  await (options.fetchImpl ?? fetch)(`${base}/v1/app/updated`, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
}
