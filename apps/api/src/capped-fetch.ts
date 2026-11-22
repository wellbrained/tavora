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

/**
 * fetch, following a redirect only to the same origin (scheme, host and port), at most three times. A redirect to
 * anywhere else is not followed: its 3xx answer is what comes back.
 */
export async function fetchSameOrigin(fetchFn: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  const origin = new URL(url).origin;
  let current = url;
  for (let hop = 0; ; hop++) {
    const response = await fetchFn(current, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status > 399 || !location || hop >= MAX_REDIRECTS) return response;
    const next = new URL(location, current);
    if (next.origin !== origin) return response;
    await response.body?.cancel().catch(() => {});
    current = next.href;
  }
}
