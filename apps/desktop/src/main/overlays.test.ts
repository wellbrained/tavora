import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@tavora/sdk/protocol";
import { setOverlayFont } from "./overlay-font";
import { OVERLAY_CSP, OVERLAY_SANDBOX, OverlayServer, OverlayStore, overlayPageOrigin, overlayUrl, OVERLAYS_FILE, streamOverlayCsp, type OverlayLink, type OverlaySubject } from "./overlays";

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

const subject = (key = "item-1", workspaceId = "poe2"): OverlaySubject => ({ owner: "official", moduleId: "tavora.clock-counter", workspaceId, key });

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

  it("forgets a workspace's links", async () => {
    const store = await OverlayStore.load(dir);
    const kept = store.link(subject("a", "poe2")).token;
    const gone = store.link(subject("a", "elden-ring")).token;
    store.forget((link) => link.workspaceId === "elden-ring");
    expect(store.find(kept)).not.toBeNull();
    expect(store.find(gone)).toBeNull();
  });

  it("limits the overlays of one module in one workspace", async () => {
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

function get(port: number, pathname: string, host = `127.0.0.1:${port}`, method = "GET", headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: pathname, method, headers: { ...headers, Host: host } }, (res) => {
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
function events(port: number, pathname: string, count: number, host = `127.0.0.1:${port}`): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const seen: unknown[] = [];
    const req = request({ host: "127.0.0.1", port, path: pathname, headers: { Host: host } }, (res) => {
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

  /** The Host of a link's own page, as OBS's browser sends it inside the frame page. */
  const pageHost = (token: string) => `${token}.localhost:${port}`;
  const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

  it("serves Tavora's frame page at the link: the module's page fills a sandboxed frame on an origin of its own", async () => {
    const { token } = store.link(subject());
    expect(overlayUrl(port, token)).toBe(`http://127.0.0.1:${port}/overlay/${token}/`);
    const frame = await get(port, `/overlay/${token}/`);
    expect(frame.status).toBe(200);
    expect(frame.headers["content-type"]).toContain("text/html");
    expect(frame.headers["x-content-type-options"]).toBe("nosniff");
    // Nothing of the module in it: just the frame.
    expect(frame.body).not.toContain("overlay.js");
    const iframe = /<iframe [^>]*>/.exec(frame.body)![0];
    expect(iframe).toContain(`src="${overlayPageOrigin(port, token)}/"`);
    expect(iframe).toContain(`sandbox="${OVERLAY_SANDBOX}"`);
    expect(OVERLAY_SANDBOX.split(" ").sort()).toEqual(["allow-same-origin", "allow-scripts"]);
    expect(overlayPageOrigin(port, token)).toBe(`http://${token}.localhost:${port}`);

    // Its policy: nothing but its own script and style, and a frame that shows only the page's origin.
    const csp = String(frame.headers["content-security-policy"]).split("; ");
    const script = /<script>(.*?)<\/script>/.exec(frame.body)![1]!;
    const style = /<style>(.*?)<\/style>/.exec(frame.body)![1]!;
    expect(csp).toEqual([
      "default-src 'none'",
      `script-src ${sha256(script)}`,
      `style-src ${sha256(style)}`,
      `frame-src ${overlayPageOrigin(port, token)}`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]);
    // Transparent, filling the Browser Source, no scrollbars.
    expect(style).toContain("background:transparent");
    expect(style).toContain("overflow:hidden");
    expect(iframe).toContain('scrolling="no"');
  });

  it("hands the link's query on to the page, as text", async () => {
    const { token } = store.link(subject());
    const frame = await get(port, `/overlay/${token}/?a=1&b="x"`);
    expect(frame.body).toContain(`src="${overlayPageOrigin(port, token)}/?a=1&amp;b=%22x%22"`);
  });

  it("serves the module's page and the files next to it on the link's own origin, locked down", async () => {
    const { token } = store.link(subject());
    const page = await get(port, "/", pageHost(token), "GET", { "Sec-Fetch-Dest": "iframe" });
    expect(page.status).toBe(200);
    expect(page.body).toContain("overlay.js");
    expect(page.headers["content-security-policy"]).toBe(streamOverlayCsp(port));
    expect(streamOverlayCsp(port)).toBe(OVERLAY_CSP.replace("frame-ancestors 'none'", `frame-ancestors http://127.0.0.1:${port} http://localhost:${port}`));
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    const script = await get(port, "/assets/overlay.js", pageHost(token));
    expect(script.status).toBe(200);
    expect(script.headers["content-type"]).toContain("javascript");
    expect(script.headers["content-security-policy"]).toBe(streamOverlayCsp(port));
    // Only on its own origin: the frame page's address serves none of the module's files.
    expect((await get(port, `/overlay/${token}/assets/overlay.js`)).status).toBe(404);
  });

  it("never serves the module's page as a page of its own, only inside the frame", async () => {
    const { token } = store.link(subject());
    expect((await get(port, "/", pageHost(token), "GET", { "Sec-Fetch-Dest": "document" })).status).toBe(404);
    expect((await get(port, "/assets/overlay.js", pageHost(token), "GET", { "Sec-Fetch-Dest": "document" })).status).toBe(404);
    expect((await get(port, "/", pageHost(token), "GET", { "Sec-Fetch-Dest": "iframe" })).status).toBe(200);
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
    expect((await get(port, "/", `${token}.evil.example:${port}`)).status).toBe(421);
    expect((await get(port, "/", `${token}.localhost:${port + 1}`)).status).toBe(421);
    expect((await get(port, "/", `evil.localhost:${port}`)).status).toBe(421);
    expect((await get(port, "/", `${token}.localhost`)).status).toBe(421);
    expect((await get(port, "/", pageHost(token).toUpperCase())).status).toBe(200);
  });

  it("serves nothing for an unknown token, a path out of the package, or a module that lost the connector", async () => {
    const { token } = store.link(subject());
    expect((await get(port, `/overlay/${"0".repeat(32)}/`)).status).toBe(404);
    expect((await get(port, "/", pageHost("0".repeat(32)))).status).toBe(404);
    expect((await get(port, "/../secret.txt", pageHost(token))).status).toBe(404);
    expect((await get(port, "/%2e%2e/secret.txt", pageHost(token))).status).toBe(404);
    expect((await get(port, `/overlay/${token}/../secret.txt`)).status).toBe(404);
    expect((await get(port, `/`)).status).toBe(404);
    allowed = false;
    expect((await get(port, `/overlay/${token}/`)).status).toBe(404);
    expect((await get(port, "/", pageHost(token))).status).toBe(404);
    expect((await get(port, "/_state", pageHost(token))).status).toBe(404);
  });

  it("only answers GET and HEAD", async () => {
    const { token } = store.link(subject());
    expect((await get(port, `/overlay/${token}/`, undefined, "POST")).status).toBe(405);
    expect((await get(port, "/", pageHost(token), "POST")).status).toBe(405);
    expect((await get(port, `/overlay/${token}/`, undefined, "HEAD")).status).toBe(200);
    expect((await get(port, "/", pageHost(token), "HEAD")).status).toBe(200);
  });

  it("streams what the module publishes to its page, starting with what it shows now", async () => {
    store.publish(subject(), { value: 1 });
    const { token } = store.link(subject());
    const seen = events(port, "/_state", 3, pageHost(token));
    await new Promise((resolve) => setTimeout(resolve, 100));
    store.publish(subject(), { value: 2 });
    store.remove(subject());
    expect(await seen).toEqual([
      { state: { value: 1 }, font: "inter" },
      { state: { value: 2 }, font: "inter" },
      { state: null, font: "inter" },
    ]);
  });

  it("keeps streaming to a page an older Tavora served at the link itself", async () => {
    store.publish(subject(), { value: 1 });
    const { token } = store.link(subject());
    expect(await events(port, `/overlay/${token}/_state`, 1)).toEqual([{ state: { value: 1 }, font: "inter" }]);
    expect((await get(port, `/overlay/${token}/_font.css`)).status).toBe(200);
  });

  it("sends the state again with the new font when the user picks another, and serves that font next to the page", async () => {
    store.publish(subject(), { value: 1 });
    const { token } = store.link(subject());
    const seen = events(port, "/_state", 2, pageHost(token));
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      setOverlayFont({ id: "allo", family: '"Tavora Allo", system-ui, sans-serif' });
      expect(await seen).toEqual([
        { state: { value: 1 }, font: "inter" },
        { state: { value: 1 }, font: "allo" },
      ]);
      const css = await get(port, "/_font.css", pageHost(token));
      expect(css.status).toBe(200);
      expect(css.headers["content-type"]).toContain("text/css");
      expect(css.body).toContain('font-family: "Tavora Allo"');
      expect(css.body).toContain(':root { --tavora-font-sans: "Tavora Allo", system-ui, sans-serif; }');
    } finally {
      setOverlayFont(undefined);
    }
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

  it("stopped while it starts: it doesn't run", async () => {
    await server.stop();
    const started = server.start(port);
    await server.stop();
    await started;
    expect(server).toMatchObject({ status: "off", port: null });
    await expect(get(port, "/")).rejects.toThrow();
  });

  it("two quick port changes leave one server, which stop ends", async () => {
    // A second free port.
    const probe = new OverlayServer({ store, page: () => null });
    let other = port + 1;
    for (; (await probe.start(other)) !== "running"; other++);
    await probe.stop();
    await server.stop();
    const [first, second] = await Promise.all([server.start(port), server.start(other)]);
    expect([first, second]).toEqual(["running", "running"]);
    expect(server.port).toBe(other);
    await expect(get(port, "/")).rejects.toThrow();
    await server.stop();
    await expect(get(other, "/")).rejects.toThrow();
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
