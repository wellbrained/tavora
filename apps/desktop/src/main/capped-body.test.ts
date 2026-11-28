import { describe, expect, it } from "vitest";
import { readJsonCapped, readTextCapped } from "./capped-body";

/** An answer that sends `chunks` pieces of `size` bytes, and counts how many were pulled. */
function streamed(chunks: number, size: number, headers: Record<string, string> = {}) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks) return controller.close();
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
  });
  return { response: new Response(body, { headers }), pulled: () => pulled };
}

describe("readTextCapped", () => {
  it("reads an answer up to the cap", async () => {
    expect(await readTextCapped(new Response("héllo"), 6)).toBe("héllo");
    expect(await readTextCapped(new Response(null), 10)).toBe("");
  });

  it("stops reading past the cap", async () => {
    const endless = streamed(1_000_000, 1024);
    expect(await readTextCapped(endless.response, 10 * 1024)).toBeNull();
    expect(endless.pulled()).toBeLessThan(20);
  });

  it("refuses a plain answer whose declared length is past the cap without reading it", async () => {
    const big = streamed(10, 1024, { "content-length": String(10 * 1024) });
    expect(await readTextCapped(big.response, 1024)).toBeNull();
    expect(big.pulled()).toBeLessThan(3);
  });
});

describe("readJsonCapped", () => {
  it("parses JSON, and throws for a body past the cap or one that isn't JSON", async () => {
    expect(await readJsonCapped(new Response('{"modules":[]}'), 100)).toEqual({ modules: [] });
    await expect(readJsonCapped(new Response('{"modules":[]}'), 5)).rejects.toThrow();
    await expect(readJsonCapped(new Response("<html>"), 100)).rejects.toThrow();
  });
});
