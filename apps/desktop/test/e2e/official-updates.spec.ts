// Tavora's own modules updating from the catalogue: a copy signed by the pinned Tavora key installs from a
// test catalogue, survives a restart, falls back to the shipped copy when it was tampered with, and the
// shipped copy still opens what the newer one saved. With the pins empty nothing is asked or loaded.
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { fingerprint, packModule } from "@tavora/pack";
import { expectModuleText, launch, newUserData, openModule, openWorkspace } from "./harness";

const ID = "tavora.updatable";

/** The module page: shows its version and what earlier versions saved, then adds its own version to that list. */
const PAGE_SCRIPT = `
const text = (id, value) => (document.querySelector('[data-testid="' + id + '"]').textContent = value);
const version = document.documentElement.dataset.version;
text("version", version);
const port = await new Promise((resolve) => {
  addEventListener("message", function on(event) {
    if (event.data?.type !== "tavora:port" || !event.ports[0]) return;
    removeEventListener("message", on);
    resolve(event.ports[0]);
  });
  postMessage({ type: "tavora:hello", v: 1 }, location.origin);
});
port.start();
let next = 1;
const call = (method, params) =>
  new Promise((resolve) => {
    const id = next++;
    port.addEventListener("message", function on(event) {
      if (event.data?.id !== id) return;
      port.removeEventListener("message", on);
      resolve(event.data);
    });
    port.postMessage({ v: 1, id, method, params });
  });
await call("bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" });
const seen = (await call("storage.app.get", { key: "seen" })).result ?? [];
text("seen", seen.join(","));
await call("storage.app.set", { key: "seen", value: [...seen, version] });
text("saved", "yes");
`;

async function moduleFolder(version: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-official-module-"));
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({ id: ID, name: "Updatable", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] }, minTavora: "0.1.0" }),
  );
  await writeFile(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="en" data-version="${version}"><head><meta charset="utf-8" /><title>Updatable</title><script type="module" src="./page.js"></script></head><body><p data-testid="version"></p><p data-testid="seen"></p><p data-testid="saved"></p></body></html>`,
  );
  await writeFile(path.join(dir, "page.js"), PAGE_SCRIPT);
  return dir;
}

/** A catalogue that lists the module at one version, only to a request that asks for Tavora's own modules. */
async function catalogue(entry: Record<string, unknown>, zip: Buffer): Promise<{ url: string; server: Server; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://catalog");
    asked.push(url.pathname + url.search);
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === "/v1/catalog") return send(200, { modules: url.searchParams.get("include") === "official" ? [entry] : [] });
    if (url.pathname === `/v1/catalog/modules/${ID}`) return send(200, { module: entry, versions: [{ version: entry.version, publishedAt: "2026-10-30T10:00:00.000Z", notes: ["Better."] }], readme: null });
    if (url.pathname === `/v1/catalog/zips/${(entry.zip as { sha256: string }).sha256}.zip`) {
      response.writeHead(200, { "content-type": "application/zip" });
      return response.end(zip);
    }
    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server, asked };
}

test("a built-in module updates from the catalogue, survives a restart, falls back when tampered with, and the shipped copy still opens its data", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const owner = fingerprint(key);
  const shipped = await mkdtemp(path.join(tmpdir(), "tavora-official-shipped-"));
  const shippedModule = path.join(shipped, "updatable");
  await mkdir(shippedModule);
  const first = await moduleFolder("1.0.0");
  for (const name of ["tavora.module.json", "index.html", "page.js"]) await writeFile(path.join(shippedModule, name), await readFile(path.join(first, name)));
  const zip = (await packModule(await moduleFolder("1.1.0"), key)).zip;
  const entry = {
    id: ID,
    name: "Updatable",
    description: null,
    version: "1.1.0",
    minTavora: "0.1.0",
    games: [],
    personalWorkspaces: true,
    workspaces: true,
    permissions: { network: [], connectors: [] },
    owner,
    publisher: null,
    zip: { sha256: createHash("sha256").update(zip).digest("hex"), size: zip.length },
    publishedAt: "2026-10-30T10:00:00.000Z",
    notes: ["Better."],
  };
  const { url, server, asked } = await catalogue(entry, zip);
  const userData = await newUserData();
  const env = { TAVORA_API_URL: url, TAVORA_OFFICIAL_MODULE_DIRS: shipped, TAVORA_OFFICIAL_PINS: `${owner}:account-tavora` };
  const run = async () => {
    const running = await launch(userData, [], { env });
    await openWorkspace(running.page, "poe2");
    return running;
  };
  try {
    // The shipped copy runs first, and saves what it saw.
    let { app, page } = await run();
    await openModule(page, ID);
    await expectModuleText(app, ID, "version", "1.0.0");
    await expectModuleText(app, ID, "seen", "");
    await expectModuleText(app, ID, "saved", "yes");

    // The update check asks for Tavora's own modules too; the update waits for the user's yes like any other.
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-modules").click();
    await page.getByTestId("check-module-updates").click();
    await expect(page.getByTestId("toast")).toHaveText("Found 1 update. It is ready when you are.");
    expect(asked).toContain("/v1/catalog?include=official");
    await page.getByTestId("settings-close").click();
    await page.getByTestId("module-updates-button").click();
    await expect(page.getByTestId(`update-versions-${ID}`)).toHaveText("1.0.0 → 1.1.0");
    await page.getByTestId(`update-module-${ID}`).click();
    await expect(page.getByTestId("module-updates-empty")).toBeVisible();
    await expectModuleText(app, ID, "version", "1.1.0");
    await app.close();

    // The panel took the new copy at once. After a restart it still runs, and sees what the shipped one saved.
    ({ app, page } = await run());
    await openModule(page, ID);
    await expectModuleText(app, ID, "version", "1.1.0");
    await expectModuleText(app, ID, "seen", "1.0.0,1.1.0");
    await expectModuleText(app, ID, "saved", "yes");
    await app.close();

    // A copy changed on disk is not trusted: the shipped one runs, and opens what the newer one saved.
    await writeFile(path.join(userData, "official-updates", ID, "page.js"), `${PAGE_SCRIPT}\n// changed`);
    ({ app, page } = await run());
    await openModule(page, ID);
    await expectModuleText(app, ID, "version", "1.0.0");
    await expectModuleText(app, ID, "seen", "1.0.0,1.1.0,1.1.0");
    await expectModuleText(app, ID, "saved", "yes");
    await app.close();
  } finally {
    server.close();
  }
});

test("with the pins empty, Tavora's own modules are not asked for and nothing downloaded is loaded", async () => {
  const shipped = await mkdtemp(path.join(tmpdir(), "tavora-official-shipped-"));
  await mkdir(path.join(shipped, "updatable"));
  const first = await moduleFolder("1.0.0");
  for (const name of ["tavora.module.json", "index.html", "page.js"]) await writeFile(path.join(shipped, "updatable", name), await readFile(path.join(first, name)));
  const { url, server, asked } = await catalogue({ id: ID, version: "9.0.0", zip: { sha256: "0".repeat(64), size: 1 } }, Buffer.alloc(0));
  try {
    const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: url, TAVORA_OFFICIAL_MODULE_DIRS: shipped } });
    await openWorkspace(page, "poe2");
    await openModule(page, ID);
    await expectModuleText(app, ID, "version", "1.0.0");
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-modules").click();
    await page.getByTestId("check-module-updates").click();
    await expect(page.getByTestId("toast")).toBeVisible();
    expect(asked.filter((line) => line.includes("official"))).toEqual([]);
    await app.close();
  } finally {
    server.close();
  }
});
