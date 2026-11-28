// A service's answer read with a cap, so a broken or hijacked service can't stream a huge body into the main process
// before the timeout ends it. Zips and pictures have their own capped reader (catalog-client.ts `read`).

/** The body as text, read with `max` bytes as a cap: null past it, and the rest is never read. */
export async function readTextCapped(response: Response, max: number): Promise<string | null> {
  // A compressed answer gives the compressed length, so only a plain one is judged up front.
  const declared = response.headers.has("content-encoding") ? NaN : Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The body as JSON, read with `max` bytes as a cap. Throws, like `response.json()`, for one past it or one that isn't JSON. */
export async function readJsonCapped(response: Response, max: number): Promise<unknown> {
  const text = await readTextCapped(response, max);
  if (text === null) throw new Error(`the answer is larger than ${max} bytes`);
  return JSON.parse(text) as unknown;
}
