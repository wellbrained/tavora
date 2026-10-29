// Browser panel gate tests (the threat model, B1 to B10). Web pages are
// served by a local test server; host resolver rules give it "public" names,
// so a page can be public and still be served from this machine.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launch, openWorkspace, openModule } from "./harness";

const BROWSER = "tavora.browser";
/** A name EasyList blocks (`||doubleclick.net^`), resolved to the test server. */
const AD_HOST = "securepubads.g.doubleclick.net";

let server: Server;
let tls: Server;
let port: number;
let tlsPort: number;
const hits: string[] = [];

/** openssl from PATH, or else the one Git for Windows ships (Windows has none of its own). */
function openssl(): string {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return "openssl";
  } catch {
    const git = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    // git --exec-path is <Git>/mingw64/libexec/git-core; the openssl is in <Git>/usr/bin.
    const bundled = path.join(git, "..", "..", "..", "usr", "bin", "openssl.exe");
    if (existsSync(bundled)) return bundled;
    throw new Error("No openssl found: install one or put it on PATH (Git for Windows ships one in usr\\bin).");
  }
}

/** A public page address: the name is mapped to 127.0.0.1 by the host resolver rules. */
const publicUrl = (pathname: string) => `http://public.test:${port}${pathname}`;
const localUrl = (pathname: string) => `http://127.0.0.1:${port}${pathname}`;
const ARGS = () => [`--host-resolver-rules=MAP public.test 127.0.0.1, MAP other.test 127.0.0.1, MAP ${AD_HOST} 127.0.0.1`];

const PAGES: Record<string, (request: IncomingMessage) => string> = {
  "/page": () => `<title>Test page</title><h1>Hello</h1>`,
  "/ads": () => `<title>Ads</title><script src="http://${AD_HOST}:${port}/tag/js/gpt.js"></script><h1>Ads</h1>`,
  "/opener": () => `<title>Opener</title>
    <a id="blank" href="${publicUrl("/page")}" target="_blank" style="position:fixed;inset:0;display:block">open</a>
    <script>window.openNow = () => window.open(${JSON.stringify(publicUrl("/popup"))}) === null;</script>`,
  "/burst": () => `<title>Burst</title>
    <div id="burst" style="position:fixed;inset:0"></div>
    <script>document.getElementById("burst").addEventListener("click", () => { for (let i = 0; i < 5; i++) window.open(${JSON.stringify(publicUrl("/page"))} + "?n=" + i); });</script>`,
  "/video": () => `<title>Video</title>
    <div id="player" style="position:fixed;inset:0;background:#123"></div>
    <script>document.getElementById("player").addEventListener("click", () => document.getElementById("player").requestFullscreen());</script>`,
  "/download-page": () => `<title>Download</title>`,
  "/redirect-file": () => "",
  "/redirect-local": () => "",
};

function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://x");
  hits.push(`${request.headers.host?.split(":")[0]}${url.pathname}`);
  if (url.pathname === "/redirect-file") return response.writeHead(302, { Location: "file:///etc/passwd" }).end();
  if (url.pathname === "/redirect-local") return response.writeHead(302, { Location: localUrl("/redirected") }).end();
  if (url.pathname === "/download") {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="tavora-e2e.bin"' });
    return response.end("payload");
  }
  const page = PAGES[url.pathname];
  response.writeHead(200, { "Content-Type": page ? "text/html" : "text/plain" });
  response.end(page ? page(request) : "reached");
}

test.beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  // A self-signed certificate, which a page must never be opened with.
  const dir = mkdtempSync(path.join(tmpdir(), "tavora-tls-"));
  execFileSync(openssl(), ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=public.test", "-days", "1", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "ignore" });
  tls = createHttpsServer({ key: readFileSync(path.join(dir, "key.pem")), cert: readFileSync(path.join(dir, "cert.pem")) }, handle);
  await new Promise<void>((resolve) => tls.listen(0, "127.0.0.1", resolve));
  tlsPort = (tls.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => tls.close(resolve));
});

test.beforeEach(() => {
  hits.length = 0;
});

function address(page: Page) {
  return page.locator('[data-testid^="browser-address-"]').first();
}

async function go(page: Page, url: string) {
  await address(page).click();
  await address(page).fill(url);
  await address(page).press("Enter");
}

/** The contents of the Browser panel's page, found by its address. */
async function pageUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .map((contents) => contents.getURL())
      .filter((url) => url.startsWith("http")),
  );
}

/** Runs JavaScript in the Browser page whose address starts with `prefix`. */
async function inPage<T>(app: ElectronApplication, prefix: string, script: string): Promise<T> {
  return app.evaluate(
    async ({ webContents }, { prefix, script }) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL().startsWith(prefix));
      if (!contents) throw new Error(`no page at ${prefix}`);
      return contents.executeJavaScript(script, true);
    },
    { prefix, script },
  ) as Promise<T>;
}

/** A real click (a trusted input event) in the middle of the page at `prefix`. */
async function clickPage(app: ElectronApplication, prefix: string) {
  await app.evaluate(({ webContents }, prefix) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().startsWith(prefix))!;
    for (const type of ["mouseDown", "mouseUp"] as const) contents.sendInputEvent({ type, x: 100, y: 100, button: "left", clickCount: 1 });
  }, prefix);
}

async function pressInPage(app: ElectronApplication, prefix: string, keyCode: string) {
  await app.evaluate(({ webContents }, { prefix, keyCode }) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().startsWith(prefix))!;
    contents.focus();
    contents.sendInputEvent({ type: "keyDown", keyCode });
    contents.sendInputEvent({ type: "keyUp", keyCode });
  }, { prefix, keyCode });
}

async function waitForPage(app: ElectronApplication, prefix: string) {
  await expect.poll(async () => (await pageUrls(app)).some((url) => url.startsWith(prefix))).toBe(true);
  await expect.poll(() => inPage(app, prefix, "document.readyState").catch(() => null)).toBe("complete");
}

test("a page cannot reach Tavora, modules, other schemes or the local network (B1–B3, B7)", async () => {
  const { app, page } = await launch(undefined, [], { args: ARGS() });
  await openModule(page, BROWSER);
  await go(page, publicUrl("/page"));
  await waitForPage(app, publicUrl("/page"));
  await expect(page.locator('[data-panel-tab][data-module-id="tavora.browser"]')).toContainText("Test page");
  await expect(page.getByTestId("browser-not-secure")).toBeVisible();

  // B1: nothing of Node, Electron or the host in the page.
  const globals = await inPage<Record<string, string>>(
    app,
    publicUrl("/"),
    `({ require: typeof require, process: typeof process, ipcRenderer: typeof ipcRenderer, electron: typeof electron, tavoraHost: typeof tavoraHost, tavora: typeof tavora })`,
  );
  for (const [name, type] of Object.entries(globals)) expect(type, `${name} must not exist`).toBe("undefined");

  // B2 and B7: module files and this PC are out of reach from a public page.
  const probes = await inPage<Record<string, boolean>>(
    app,
    publicUrl("/"),
    `(async () => {
      const ok = (promise) => promise.then(() => true, () => false);
      const image = (src) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = src; });
      const frame = document.createElement("iframe");
      frame.src = ${JSON.stringify(localUrl("/frame"))};
      document.body.append(frame);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        moduleFile: await ok(fetch("tavora-module://tavora.notes/tavora.module.json")),
        localFetch: await ok(fetch(${JSON.stringify(localUrl("/secret"))}, { mode: "no-cors" })),
        localImage: await image(${JSON.stringify(localUrl("/pixel"))}),
        loopbackName: await ok(fetch("http://localhost:${port}/secret2", { mode: "no-cors" })),
        fileFetch: await ok(fetch("file:///etc/hostname")),
      };
    })()`,
  );
  for (const [probe, reached] of Object.entries(probes)) expect(reached, `${probe} must fail`).toBe(false);
  expect(hits.filter((hit) => !hit.startsWith("public.test"))).toEqual([]);

  // B3 and B7: the page cannot take the panel to another scheme or to this PC.
  for (const target of ["file:///etc/passwd", "tavora-module://tavora.notes/dist/index.html", "steam://run/730", localUrl("/local-nav")]) {
    await inPage(app, publicUrl("/"), `location.href = ${JSON.stringify(target)}; null`);
    await page.waitForTimeout(400);
    expect(await pageUrls(app)).toEqual([publicUrl("/page")]);
  }
  // Nor can a redirect.
  for (const target of ["/redirect-file", "/redirect-local"]) {
    await inPage(app, publicUrl("/"), `location.href = ${JSON.stringify(target)}; null`);
    await page.waitForTimeout(400);
    expect((await pageUrls(app)).some((url) => url.startsWith("file:") || url.startsWith(localUrl("/")))).toBe(false);
  }
  expect(hits).not.toContain("127.0.0.1/local-nav");
  expect(hits).not.toContain("127.0.0.1/redirected");

  // What the user types may be local, and a local page may use local addresses.
  await go(page, localUrl("/page"));
  await waitForPage(app, localUrl("/page"));
  expect(await inPage(app, localUrl("/"), `fetch("/secret").then((r) => r.text())`)).toBe("reached");

  // B6: permissions are denied.
  const permissions = await inPage<Record<string, string>>(
    app,
    localUrl("/"),
    `(async () => ({
      notifications: await Notification.requestPermission(),
      geolocation: await new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve("granted"), (error) => resolve("denied " + error.code))),
      camera: await navigator.mediaDevices.getUserMedia({ video: true }).then(() => "granted", (error) => "denied " + error.name),
    }))()`,
  );
  expect(permissions.notifications).toBe("denied");
  expect(permissions.geolocation).toBe("denied 1");
  expect(permissions.camera).not.toBe("granted");

  await app.close();
});

test("new windows open as a Browser tab only after a click, and downloads are refused (B4, B5)", async () => {
  const { app, page } = await launch(undefined, [], { args: ARGS() });
  await openModule(page, BROWSER);
  await go(page, publicUrl("/opener"));
  await waitForPage(app, publicUrl("/opener"));

  // B4: a popup nobody asked for is dropped; no window ever opens.
  expect(await inPage(app, publicUrl("/"), "window.openNow()")).toBe(true);
  await page.waitForTimeout(500);
  expect(hits).not.toContain("public.test/popup");
  // A clicked target=_blank link opens as a new Browser tab, not a window.
  await clickPage(app, publicUrl("/opener"));
  await waitForPage(app, publicUrl("/page"));
  // Both are tabs of one group; only the shown tab draws its toolbar.
  await expect(page.locator('[data-panel-tab][data-module-id="tavora.browser"]')).toHaveCount(2);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  // One click opens one tab, however many windows the page asks for.
  await go(page, publicUrl("/burst"));
  await waitForPage(app, publicUrl("/burst"));
  await clickPage(app, publicUrl("/burst"));
  await waitForPage(app, publicUrl("/page?n=0"));
  await page.waitForTimeout(500);
  await expect(page.locator('[data-panel-tab][data-module-id="tavora.browser"]')).toHaveCount(3);

  // B5: a download is refused and the user is told.
  const downloads = await app.evaluate(({ app }) => app.getPath("downloads"));
  await inPage(app, publicUrl("/"), `location.href = "/download"; null`);
  await expect(page.getByTestId("toast").getByText("Tavora doesn't download files.")).toBeVisible();
  expect(() => readFileSync(path.join(downloads, "tavora-e2e.bin"))).toThrow();

  await app.close();
});

test("certificate errors are never clicked through (B8)", async () => {
  const { app, page } = await launch(undefined, [], { args: ARGS() });
  await openModule(page, BROWSER);
  await go(page, `https://public.test:${tlsPort}/page`);
  await expect(page.locator('[data-testid^="browser-error-"]')).toContainText("certificate");
  expect(hits).toEqual([]);
  await app.close();
});

test("ads are blocked unless allowed for the site", async () => {
  const { app, page } = await launch(undefined, [], { args: ARGS() });
  await openModule(page, BROWSER);
  await go(page, publicUrl("/ads"));
  await waitForPage(app, publicUrl("/ads"));
  await expect(page.getByTestId("browser-adblock")).not.toHaveAttribute("data-blocked", "0");
  expect(hits).not.toContain(`${AD_HOST}/tag/js/gpt.js`);

  // Allowing ads reloads nothing by itself; the next load lets them through.
  await page.getByTestId("browser-adblock").click();
  await expect(page.getByTestId("browser-adblock")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("browser-reload").click();
  await expect.poll(() => hits).toContain(`${AD_HOST}/tag/js/gpt.js`);
  await app.close();
});

test("sign-ins are per workspace unless the site is shared, and the panel reopens where it was (B10)", async () => {
  const first = await launch(undefined, [], { args: ARGS() });
  let { app, page } = first;
  const cookie = (url: string) => inPage<string>(app, url, "document.cookie");

  await openModule(page, BROWSER);
  await go(page, publicUrl("/page"));
  await waitForPage(app, publicUrl("/page"));
  await inPage(app, publicUrl("/"), `document.cookie = "who=poe2; max-age=3600"; null`);

  // Another game's Browser has its own cookies.
  await openWorkspace(page, "satisfactory");
  await openModule(page, BROWSER);
  await go(page, publicUrl("/page"));
  await waitForPage(app, publicUrl("/page"));
  expect(await cookie(publicUrl("/"))).toBe("");

  // Signed in for all workspaces: the site moves to the shared session.
  await page.getByTestId("browser-shared").click();
  await expect(page.getByTestId("browser-shared")).toHaveAttribute("aria-pressed", "true");
  await waitForPage(app, publicUrl("/page"));
  await inPage(app, publicUrl("/"), `document.cookie = "shared=yes; max-age=3600"; null`);
  await openWorkspace(page, "poe2");
  await waitForPage(app, publicUrl("/page"));
  await expect(page.getByTestId("browser-shared")).toHaveAttribute("aria-pressed", "true");
  expect(await cookie(publicUrl("/"))).toBe("shared=yes");
  // Other sites stay per game.
  await go(page, `http://other.test:${port}/page`);
  await waitForPage(app, `http://other.test:${port}/page`);
  await expect(page.getByTestId("browser-shared")).toHaveAttribute("aria-pressed", "false");

  // The panel opens where it was after a restart.
  await app.close();
  ({ app, page } = await launch(first.userData, [], { args: ARGS() }));
  await waitForPage(app, `http://other.test:${port}/page`);
  await app.close();
});

test("fullscreen video fills the panel, never the window", async () => {
  const { app, page } = await launch(undefined, [], { args: ARGS() });
  await openModule(page, BROWSER);
  await go(page, publicUrl("/video"));
  await waitForPage(app, publicUrl("/video"));
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds());

  await clickPage(app, publicUrl("/video"));
  await expect(page.getByTestId("browser-exit-fullscreen")).toBeVisible();
  expect(await inPage(app, publicUrl("/"), "document.fullscreenElement?.id ?? null")).toBe("player");
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())).toEqual(before);
  // The page fills the panel's page area, not the screen.
  const size = await inPage<{ width: number; height: number }>(app, publicUrl("/"), "({ width: innerWidth, height: innerHeight })");
  const area = await page.locator('[data-testid^="panel-content-"]').first().boundingBox();
  expect(Math.abs(size.width - area!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(size.height - area!.height)).toBeLessThanOrEqual(2);

  await pressInPage(app, publicUrl("/video"), "Escape");
  await expect(page.getByTestId("browser-exit-fullscreen")).toHaveCount(0);
  expect(await inPage(app, publicUrl("/"), "document.fullscreenElement")).toBeNull();
  await app.close();
});
