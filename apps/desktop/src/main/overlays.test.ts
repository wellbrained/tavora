import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@tavora/sdk/protocol";
import { OVERLAY_CSP, OverlayServer, OverlayStore, overlayUrl, OVERLAYS_FILE, type OverlayLink, type OverlaySubject } from "./overlays";

let dir: string;
let root: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-overlays-"));
  root = path.join(dir, "module");
  await mkdir(path.join(root, "dist", "assets"), { recursive: true });
  await writeFile(path.join(root, "dist", "overlay.html"), "<!doctype html><script src=./assets/overlay.js></script>");
  await writeFile(path.join(root, "dist", "assets", "overlay.js"), "console.log('hi')");
  await writeFile(path.join(root, "secret.txt"), "not for OBS");
});

afterEach(async () => {
  // Saves run in the background; let the last one land first.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const subject = (key = "item-1", gameId = "poe2"): OverlaySubject => ({ owner: "official", moduleId: "tavora.clock-counter", gameId, key });

describe("OverlayStore", () => {
  it("gives a key one link, and keeps links and states across a restart", async () => {
    const store = await OverlayStore.load(dir);
    const first = store.link(subject());
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(store.link(subject()).token).toBe(first.token);
    expect(store.link(subject("item-2")).token).not.toBe(first.token);
    store.publish(subject(), { value: 3 });
    await store.save();

    const again = await OverlayStore.load(dir);
    expect(again.find(first.token)).toEqual({ link: { ...subject(), token: first.token }, state: { value: 3 } });
  });

  it("shows nothing after remove but keeps the link, so Undo brings it back", async () => {
    const store = await OverlayStore.load(dir);
    store.publish(subject(), { value: 1 });
    const { token } = store.link(subject());
    store.remove(subject());
    expect(store.find(token)?.state).toBeNull();
    store.publish(subject(), { value: 2 });
    expect(store.find(token)?.state).toEqual({ value: 2 });
  });

  it("gives new tokens on reset, keeping what the overlay shows", async () => {
    const store = await OverlayStore.load(dir);
    store.publish(subject(), { value: 1 });
    const old = store.link(subject()).token;
    store.reset(subject());
    const next = store.link(subject()).token;
    expect(next).not.toBe(old);
    expect(store.find(old)).toBeNull();
    expect(store.find(next)?.state).toEqual({ value: 1 });
    store.resetAll();
    expect(store.find(next)).toBeNull();
  });

  it("tells watchers about changes, and that the link went away", async () => {
    const store = await OverlayStore.load(dir);
    const { token } = store.link(subject());
    const seen: unknown[] = [];
    store.watch(token, (state) => seen.push(state));
    store.publish(subject(), { value: 1 });
    store.remove(subject());
    store.reset(subject());
    expect(seen).toEqual([{ value: 1 }, null, undefined]);
  });

  it("forgets a game's links", async () => {
    const store = await OverlayStore.load(dir);
    const kept = store.link(subject("a", "poe2")).token;
    const gone = store.link(subject("a", "elden-ring")).token;
    store.forget((link) => link.gameId === "elden-ring");
    expect(store.find(kept)).not.toBeNull();
    expect(store.find(gone)).toBeNull();
  });

  it("limits the overlays of one module in one game", async () => {
    const store = await OverlayStore.load(dir);
    for (let i = 0; i < LIMITS.maxOverlays; i++) store.link(subject(`k${i}`));
    expect(() => store.link(subject("one-more"))).toThrow(expect.objectContaining({ code: "QUOTA_EXCEEDED" }));
    expect(() => store.link(subject("other-game", "elden-ring"))).not.toThrow();
  });

  it("drops broken entries in overlays.json", async () => {
    await writeFile(
      path.join(dir, OVERLAYS_FILE),
      JSON.stringify({ version: 1, links: [{ token: "nope", ...subject() }, { token: "a".repeat(32), owner: "official" }, { token: "b".repeat(32), ...subject(), state: { ok: true } }] }),
    );
    const store = await OverlayStore.load(dir);
    expect(store.find("a".repeat(32))).toBeNull();
    expect(store.find("b".repeat(32))?.state).toEqual({ ok: true });
  });
});

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function get(port: number, pathname: string, host = `127.0.0.1:${port}`, method = "GET"): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: pathname, method, headers: { Host: host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Reads server-sent events until `count` data messages came, then closes. */
function events(port: number, pathname: string, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const seen: unknown[] = [];
    const req = request({ host: "127.0.0.1", port, path: pathname, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        for (const line of buffer.split("\n\n").slice(0, -1)) {
          if (line.startsWith("data: ")) seen.push(JSON.parse(line.slice(6)));
        }
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
        if (seen.length >= count) {
          req.destroy();
          resolve(seen);
        }
      });
      res.on("end", () => resolve(seen));
    });
    req.on("error", (error) => (seen.length >= count ? resolve(seen) : reject(error)));
    req.end();
  });
}

describe("OverlayServer", () => {
  let store: OverlayStore;
  let server: OverlayServer;
  let allowed: boolean;
  let port: number;

  beforeEach(async () => {
    store = await OverlayStore.load(dir);
    allowed = true;
    server = new OverlayServer({ store, page: (link: OverlayLink) => (allowed && link.moduleId === "tavora.clock-counter" ? { root, entry: "dist/overlay.html" } : null) });
    // A port of its own per test; a busy one moves on.
    for (port = 47900 + Math.floor(Math.random() * 1000); (await server.start(port)) !== "running"; port++);
  });

  afterEach(async () => {
    await server.stop();
  });

  it("serves the overlay page and the files next to it, locked down", async () => {
    const { token } = store.link(subject());
    const page = await get(port, `/overlay/${token}/`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("overlay.js");
    expect(page.headers["content-security-policy"]).toBe(OVERLAY_CSP);
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    const script = await get(port, `/overlay/${token}/assets/overlay.js`);
    expect(script.status).toBe(200);
    expect(script.headers["content-type"]).toContain("javascript");
    expect(overlayUrl(port, token)).toBe(`http://127.0.0.1:${port}/overlay/${token}/`);
  });

  it("adds the slash a link without one is missing", async () => {
    const { token } = store.link(subject());
    const answer = await get(port, `/overlay/${token}`);
    expect(answer.status).toBe(308);
    expect(answer.headers.location).toBe(`/overlay/${token}/`);
  });

  it("refuses other Host headers, so a web page can't reach it through its own name", async () => {
    const { token } = store.link(subject());
    expect((await get(port, `/overlay/${token}/`, `evil.example:${port}`)).status).toBe(421);
    expect((await get(port, `/overlay/${token}/`, `localhost:${port}`)).status).toBe(200);
  });

  it("serves nothing for an unknown token, a path out of the package, or a module that lost the connector", async () => {
    const { token } = store.link(subject());
    expect((await get(port, `/overlay/${"0".repeat(32)}/`)).status).toBe(404);
    expect((await get(port, `/overlay/${token}/../secret.txt`)).status).toBe(404);
    expect((await get(port, `/overlay/${token}/%2e%2e/secret.txt`)).status).toBe(404);
    expect((await get(port, `/`)).status).toBe(404);
    allowed = false;
    expect((await get(port, `/overlay/${token}/`)).status).toBe(404);
  });

  it("only answers GET and HEAD", async () => {
    const { token } = store.link(subject());
    expect((await get(port, `/overlay/${token}/`, undefined, "POST")).status).toBe(405);
    expect((await get(port, `/overlay/${token}/`, undefined, "HEAD")).status).toBe(200);
  });

  it("streams what the module publishes, starting with what it shows now", async () => {
    store.publish(subject(), { value: 1 });
    const { token } = store.link(subject());
    const seen = events(port, `/overlay/${token}/_state`, 3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    store.publish(subject(), { value: 2 });
    store.remove(subject());
    expect(await seen).toEqual([{ state: { value: 1 } }, { state: { value: 2 } }, { state: null }]);
  });

  it("says when the port is in use", async () => {
    const other = new OverlayServer({ store, page: () => null });
    expect(await other.start(port)).toBe("in-use");
    expect(other.port).toBeNull();
  });

  it("stops listening when stopped", async () => {
    await server.stop();
    expect(server.status).toBe("off");
    await expect(get(port, "/")).rejects.toThrow();
  });
});

describe("overlays.json", () => {
  it("is written in full on save", async () => {
    const store = await OverlayStore.load(dir);
    store.publish(subject(), { value: 7 });
    await store.save();
    const saved = JSON.parse(await readFile(path.join(dir, OVERLAYS_FILE), "utf8")) as { links: unknown[] };
    expect(saved.links).toEqual([expect.objectContaining({ ...subject(), state: { value: 7 } })]);
  });
});
