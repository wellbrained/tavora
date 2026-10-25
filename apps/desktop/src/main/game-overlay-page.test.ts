import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonValue } from "@tavora/sdk/protocol";
import { GAME_OVERLAY_ORIGIN, serveGameOverlay, type GameOverlaySource } from "./game-overlay-page";
import { OVERLAY_CSP } from "./overlays";

let dir: string;
let root: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-game-overlay-page-"));
  root = path.join(dir, "module");
  await mkdir(path.join(root, "dist", "assets"), { recursive: true });
  await writeFile(path.join(root, "dist", "overlay.html"), "<!doctype html><script src=./assets/overlay.js></script>");
  await writeFile(path.join(root, "dist", "assets", "overlay.js"), "console.log('hi')");
  await writeFile(path.join(root, "secret.txt"), "not for the overlay");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** A source whose state the test can change. */
function source(initial: JsonValue | null = null) {
  const watchers = new Set<(state: JsonValue | null | undefined) => void>();
  let state = initial;
  let page: { root: string; entry: string } | null = { root, entry: "dist/overlay.html" };
  return {
    value: {
      page: () => page,
      state: () => state,
      watch: (fn) => (watchers.add(fn), () => void watchers.delete(fn)),
    } satisfies GameOverlaySource,
    watchers,
    publish(next: JsonValue | null | undefined) {
      if (next !== undefined) state = next;
      for (const fn of [...watchers]) fn(next);
    },
    goAway: () => (page = null),
  };
}

const get = (src: GameOverlaySource, pathname: string, init?: RequestInit) => serveGameOverlay(new Request(`${GAME_OVERLAY_ORIGIN}${pathname}`, init), src);

describe("serveGameOverlay", () => {
  it("serves the overlay page, and the files next to it, under the strict policy", async () => {
    const { value } = source();
    const page = await get(value, "/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("overlay.js");
    expect(page.headers.get("content-security-policy")).toBe(OVERLAY_CSP);
    expect(page.headers.get("content-type")).toContain("text/html");
    const script = await get(value, "/assets/overlay.js");
    expect(script.status).toBe(200);
    expect(await script.text()).toBe("console.log('hi')");
  });

  it("serves only files inside the module package, and only as the page's neighbours", async () => {
    await symlink(path.join(root, "secret.txt"), path.join(root, "dist", "link.txt")).catch(() => undefined);
    const { value } = source();
    expect((await get(value, "/../secret.txt")).status).toBe(404);
    expect((await get(value, "/%2e%2e/secret.txt")).status).toBe(404);
    expect((await get(value, "/assets/%2e%2e/%2e%2e/secret.txt")).status).toBe(404);
    expect((await get(value, "/missing.js")).status).toBe(404);
    expect((await get(value, "/assets")).status).toBe(404);
  });

  it("refuses other hosts and methods, and everything once the module is gone", async () => {
    const src = source();
    expect((await serveGameOverlay(new Request("tavora-overlay://elsewhere/"), src.value)).status).toBe(404);
    expect((await get(src.value, "/", { method: "POST", body: "x" })).status).toBe(405);
    src.goAway();
    expect((await get(src.value, "/")).status).toBe(404);
    expect((await get(src.value, "/_state")).status).toBe(404);
  });

  it("sends the published state as server-sent events, the first one right away, as watchOverlay expects", async () => {
    const src = source({ value: 1 });
    const response = await get(src.value, "/_state");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const until = async (needle: string) => {
      while (!text.includes(needle)) text += decoder.decode((await reader.read()).value);
    };
    await until(`data: {"state":{"value":1}}\n\n`);
    src.publish({ value: 2 });
    await until(`data: {"state":{"value":2}}\n\n`);
    src.publish(null);
    await until(`data: {"state":null}\n\n`);
    await reader.cancel();
    expect(src.watchers.size).toBe(0);
  });

  it("ends the stream at once when the overlay has no link, so the page asks again", async () => {
    const src = source(null);
    const reader = (await get({ ...src.value, watch: () => null }, "/_state")).body!.getReader();
    let done = false;
    for (let i = 0; i < 5 && !done; i++) done = (await reader.read()).done;
    expect(done).toBe(true);
  });

  it("ends the stream when the link goes away, so the page asks again", async () => {
    const src = source(null);
    const reader = (await get(src.value, "/_state")).body!.getReader();
    await reader.read();
    src.publish(undefined);
    let done = false;
    for (let i = 0; i < 5 && !done; i++) done = (await reader.read()).done;
    expect(done).toBe(true);
    expect(src.watchers.size).toBe(0);
  });

  it("stops watching when the request is cancelled", async () => {
    const src = source(null);
    const controller = new AbortController();
    const response = await get(src.value, "/_state", { signal: controller.signal });
    await response.body!.getReader().read();
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(src.watchers.size).toBe(0);
  });
});
