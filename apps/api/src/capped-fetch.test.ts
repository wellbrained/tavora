import { describe, expect, it } from "vitest";
import { createProbes } from "./admin-probes.ts";
import { fetchSameOrigin, readCapped, TooBigError } from "./capped-fetch.ts";
import { githubInstallerTotals } from "./github-releases.ts";

/** A body that never ends, counting how many bytes were pulled from it. */
function endless(): { body: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulled = 0;
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return { body, pulled: () => pulled };
}

describe("reading an outside answer with a cap", () => {
  it("reads a body up to the cap and stops pulling an endless one just past it", async () => {
    expect(await readCapped(new Response("hello"), 5)).toBe("hello");
    const { body, pulled } = endless();
    await expect(readCapped(new Response(body), 1024 * 1024)).rejects.toBeInstanceOf(TooBigError);
    expect(pulled()).toBeLessThan(2 * 1024 * 1024);
  });

  it("refuses at once a body whose declared length is over the cap", async () => {
    const { body, pulled } = endless();
    await expect(readCapped(new Response(body, { headers: { "content-length": "999999999" } }), 1024)).rejects.toBeInstanceOf(TooBigError);
    expect(pulled()).toBeLessThanOrEqual(64 * 1024);
  });

  it("follows a redirect on the same origin only, and at most three times", async () => {
    const asked: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      asked.push(url);
      expect(init?.redirect).toBe("manual");
      if (url.endsWith("/start")) return new Response(null, { status: 301, headers: { location: "/moved" } });
      if (url.endsWith("/moved")) return new Response(null, { status: 302, headers: { location: "https://elsewhere.test/x" } });
      if (url.endsWith("/loop")) return new Response(null, { status: 302, headers: { location: "/loop" } });
      return new Response("ok");
    }) as typeof fetch;
    const response = await fetchSameOrigin(fetchFn, "https://host.test/start");
    expect(response.status).toBe(302);
    expect(asked).toEqual(["https://host.test/start", "https://host.test/moved"]);
    asked.length = 0;
    expect((await fetchSameOrigin(fetchFn, "https://host.test/loop")).status).toBe(302);
    expect(asked).toHaveLength(4);
    // Another port or scheme is another origin.
    asked.length = 0;
    const other = (async (url: string) => {
      asked.push(url);
      return new Response(null, { status: 301, headers: { location: "http://host.test/start" } });
    }) as typeof fetch;
    await fetchSameOrigin(other, "https://host.test/start");
    expect(asked).toEqual(["https://host.test/start"]);
  });
});

describe("a redirect to another host", () => {
  it("comes back with its body cancelled, never read", async () => {
    const { body, pulled } = endless();
    const response = await fetchSameOrigin((async () => new Response(body, { status: 302, headers: { location: "https://elsewhere.test/" } })) as typeof fetch, "https://host.test/");
    expect(response.status).toBe(302);
    expect(pulled()).toBeLessThanOrEqual(2 * 64 * 1024);
  });
});

describe("the admin probes and the GitHub totals", () => {
  it("answer null for an endless or redirected answer instead of reading it", async () => {
    const { body, pulled } = endless();
    const huge = createProbes((async () => new Response(body)) as typeof fetch);
    expect(await huge.feed()).toBeNull();
    expect(pulled()).toBeLessThan(1024 * 1024);
    const asked: string[] = [];
    const away = createProbes((async (url: string) => {
      asked.push(url);
      return new Response(null, { status: 302, headers: { location: "https://evil.test/latest.yml" } });
    }) as typeof fetch);
    expect(await away.feed()).toBeNull();
    expect(await away.npmVersion("@tavora/sdk")).toBeNull();
    expect(await away.site("https://mytavora.app")).toEqual({ ok: false, status: 302, redirectsElsewhere: true });
    expect(asked.some((url) => url.includes("evil.test"))).toBe(false);
  });

  it("stop reading a GitHub page past its cap", async () => {
    const { body, pulled } = endless();
    await expect(githubInstallerTotals((async () => new Response(body)) as typeof fetch)).rejects.toBeInstanceOf(TooBigError);
    expect(pulled()).toBeLessThan(9 * 1024 * 1024);
  });
});
