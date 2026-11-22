/**
 * Reading answers from outside services with a byte cap, and following a redirect only on the same origin. The service
 * runs in 256 MB: a host that answers with an endless body (or sends it on to another host) must cost a failed ask, never
 * the process.
 */

/** Raised when an answer is bigger than its cap. */
export class TooBigError extends Error {
  constructor(maxBytes: number) {
    super(`The answer was bigger than ${maxBytes} bytes.`);
  }
}

/** The body as text, read until `maxBytes` at most; a longer one is cut off (the rest is never read) and throws. */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new TooBigError(maxBytes);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TooBigError(maxBytes);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The body as JSON, read with readCapped. */
export async function readCappedJson(response: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readCapped(response, maxBytes)) as unknown;
}

/** Most same-origin redirects followed before the answer counts as the last one. */
const MAX_REDIRECTS = 3;

/** A redirect fetchSameOrigin didn't follow: to another origin, or past its last hop. Its body was never read. */
export function isUnfollowedRedirect(response: Response): boolean {
  return response.status >= 300 && response.status <= 399 && response.headers.has("location");
}

/**
 * fetch, following a redirect only to the same origin (scheme, host and port), at most three times. A redirect to
 * anywhere else, or one more, is not followed: its 3xx answer comes back with its body cancelled (isUnfollowedRedirect).
 */
export async function fetchSameOrigin(fetchFn: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  const origin = new URL(url).origin;
  let current = url;
  for (let hop = 0; ; hop++) {
    const response = await fetchFn(current, { ...init, redirect: "manual" });
    if (!isUnfollowedRedirect(response)) return response;
    await response.body?.cancel().catch(() => {});
    const next = new URL(response.headers.get("location")!, current);
    if (next.origin !== origin || hop >= MAX_REDIRECTS) return response;
    current = next.href;
  }
}
