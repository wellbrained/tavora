// Module grants (decision log, module grants row of 2026-10-16): the consent dialog when a module is
// first added, adding it again without asking, taking it back in Settings > Modules (its panels
// go, an empty slot stays), and the Review bar when an update asks for more.

import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { desktopDir, inModule, launch, newUserData, panels } from "./harness";

const NETWORK = "local.test.network-module";
const FIXTURE = path.join(desktopDir, "test/network-fixture");
const ENV = { TAVORA_TEST_NETWORK_HOSTS: "api.tavora.test=127.0.0.1,cdn.tavora.test=127.0.0.1" };

let server: Server;
let port: number;

test.beforeAll(async () => {
  server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

interface Reply {
  ok?: boolean;
  result?: { status?: number; body?: string; capabilities?: string[] };
  error?: { code: string };
}

/** Opens the module library and presses Add on the module. */
async function pressAdd(page: Page, moduleId: string) {
  await page.getByTestId("add-module").click();
  await page.getByTestId(`open-${moduleId}`).click();
}

async function fetchFrom(app: Parameters<typeof inModule>[0], host: string, index = 0): Promise<Reply> {
  await expect.poll(() => inModule<Reply>(app, NETWORK, "window.handshake?.()", index).catch(() => null)).toMatchObject({ ok: true });
  return inModule<Reply>(app, NETWORK, `window.request(${JSON.stringify({ url: `http://${host}:${port}/` })})`, index);
}

async function grantsFile(userData: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(userData, "grants.json"), "utf8").catch(() => '{"owners":{}}'));
}

test("adding a module asks first, adding it again does not, and taking it back removes its panels", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData, [FIXTURE], { env: ENV });

  // The consent dialog lists what the module asks for; Cancel adds nothing.
  await pressAdd(page, NETWORK);
  await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);
  await expect(page.getByTestId("grant-dialog")).toBeVisible();
  await expect(page.getByTestId("grant-hosts").locator("li")).toHaveText(["api.tavora.test", "cdn.tavora.test"]);
  await expect(page.getByTestId("grant-from")).toContainText("not signed");
  await page.getByTestId("grant-cancel").click();
  await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
  await expect(panels(page, NETWORK)).toHaveCount(0);
  expect(await grantsFile(userData)).toMatchObject({ owners: {} });

  // Allow adds it, and it reaches the hosts.
  await pressAdd(page, NETWORK);
  await page.getByTestId("grant-allow").click();
  await expect(panels(page, NETWORK)).toHaveCount(1);
  expect(await fetchFrom(app, "api.tavora.test")).toMatchObject({ ok: true, result: { status: 200, body: "ok" } });
  expect(await grantsFile(userData)).toMatchObject({ owners: { local: { [NETWORK]: { network: ["api.tavora.test", "cdn.tavora.test"] } } } });

  // Once granted it is added without asking.
  await pressAdd(page, NETWORK);
  await expect(panels(page, NETWORK)).toHaveCount(2);
  await expect(page.getByTestId("grant-dialog")).toHaveCount(0);

  // Settings > Modules lists it; taking it back names the game it is used in.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-modules").click();
  await expect(page.getByTestId(`module-grant-${NETWORK}`)).toContainText("cdn.tavora.test");
  await page.getByTestId(`revoke-module-${NETWORK}`).click();
  await expect(page.getByTestId("confirm")).toContainText("Path of Exile 2");
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("module-grants-empty")).toBeVisible();
  await page.keyboard.press("Escape");

  // Its panels are gone and an empty slot stays where they were.
  await expect(panels(page, NETWORK)).toHaveCount(0);
  await expect(page.locator('[data-testid^="empty-slot-"]')).not.toHaveCount(0);
  expect(await grantsFile(userData)).toMatchObject({ owners: {} });

  // Adding it again asks again.
  await pressAdd(page, NETWORK);
  await expect(page.getByTestId("grant-dialog")).toBeVisible();
  await page.getByTestId("grant-cancel").click();

  await app.close();
});

test("an update that asks for more keeps working and shows a Review bar", async () => {
  // A copy of the module that asks for one host, already granted.
  const modules = await mkdtemp(path.join(tmpdir(), "tavora-grant-module-"));
  const folder = path.join(modules, "network-module");
  await cp(FIXTURE, folder, { recursive: true });
  const manifestFile = path.join(folder, "tavora.module.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as { version: string; permissions: { network: string[] } };
  await writeFile(manifestFile, JSON.stringify({ ...manifest, permissions: { network: ["api.tavora.test"] } }));
  const userData = await newUserData();
  await writeFile(
    path.join(userData, "grants.json"),
    JSON.stringify({ version: 1, owners: { local: { [NETWORK]: { version: "0.0.0", grantedAt: "2026-10-16T20:00:00.000Z", network: ["api.tavora.test"] } } } }),
  );
  const { app, page } = await launch(userData, [modules], { env: ENV });
  await pressAdd(page, NETWORK);
  await expect(panels(page, NETWORK)).toHaveCount(1);
  await expect(page.getByTestId("grant-dialog")).toHaveCount(0);

  // The update asks for a second host.
  await writeFile(manifestFile, JSON.stringify({ ...manifest, version: "0.1.0", permissions: { network: ["api.tavora.test", "cdn.tavora.test"] } }));
  await page.evaluate(() => (window as unknown as { tavoraHost: { act(action: unknown): Promise<unknown> } }).tavoraHost.act({ type: "reload-modules" }));

  // What was granted keeps working; the new host waits for the user.
  const bar = page.locator('[data-testid^="grant-review-open-"]');
  await expect(bar).toBeVisible();
  expect(await fetchFrom(app, "api.tavora.test")).toMatchObject({ ok: true });
  expect(await fetchFrom(app, "cdn.tavora.test")).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });

  // Review shows only what is new; allowing it ends the bar and the host works.
  await bar.click();
  await expect(page.getByTestId("grant-hosts").locator("li")).toHaveText(["cdn.tavora.test"]);
  await page.getByTestId("grant-allow").click();
  await expect(bar).toHaveCount(0);
  expect(await fetchFrom(app, "cdn.tavora.test")).toMatchObject({ ok: true });
  await expect(panels(page, NETWORK)).toHaveCount(1);

  await app.close();
});
