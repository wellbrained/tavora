// Isolation gate tests (docs/threat-model.md, G1 to G9). A hostile module
// attacks the host while a well-behaved module holds data worth stealing.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import {
  clickInModule,
  expectModuleText,
  HOSTILE,
  inModule,
  launch,
  openModule,
  panels,
  VANILLA,
} from "./harness";

let server: Server;
let serverUrl: string;
const hits: string[] = [];

test.beforeAll(async () => {
  server = createServer((request, response) => {
    hits.push(request.url ?? "");
    response.end("reached");
  });
  server.on("upgrade", (request, socket) => {
    hits.push(`upgrade ${request.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

interface Settled {
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface ProbeResults {
  globals: Record<string, string>;
  network: Record<string, Settled | boolean>;
  windowOpen: string;
  localStorageSecret: string | null;
  bridge: Record<string, { ok?: boolean; result?: unknown; error?: { code: string; capability?: string; supported?: number[] }; timeout?: boolean }>;
}

test("a hostile module cannot escape its sandbox, spoof identity or reach the network", async () => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, HOSTILE);
  await expectModuleText(app, VANILLA, "status", "Connected");

  // The victim stores data the attacker will try to reach.
  for (let i = 0; i < 2; i++) await clickInModule(app, VANILLA, "increment");
  await expectModuleText(app, VANILLA, "count", "2");
  await inModule(app, VANILLA, "localStorage.setItem('secret', 'victim-data')");
  await expect.poll(() => inModule(app, HOSTILE, "typeof window.runProbes").catch(() => null)).toBe("function");

  const results = await inModule<ProbeResults>(
    app,
    HOSTILE,
    `runProbes(${JSON.stringify({
      serverUrl,
      otherModuleUrl: `tavora-module://${VANILLA}/dist/index.html`,
    })})`,
  );

  if (process.env.TAVORA_PRINT_PROBES) console.log(JSON.stringify(results, null, 2));

  // G1: no Node, Electron or host APIs in the module's world.
  for (const [name, type] of Object.entries(results.globals)) {
    expect(type, `${name} must not exist`).toBe("undefined");
  }

  // G4: nothing leaves the module. The server must not see a single request.
  for (const [probe, outcome] of Object.entries(results.network)) {
    if (probe === "beacon") continue;
    expect((outcome as Settled).ok, `${probe} must fail`).toBe(false);
  }
  expect(hits, "the test server must not be reached").toEqual([]);

  // G7: no new windows.
  expect(results.windowOpen).toBe("denied");

  // G2: web storage is per module; the victim's localStorage is invisible.
  expect(results.localStorageSecret).toBeNull();

  // G3: identity comes from the host, not the message.
  const { bridge } = results;
  expect(bridge.beforeHandshake).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
  expect(bridge.futureProtocol).toMatchObject({ ok: false, error: { code: "INCOMPATIBLE", supported: [1] } });
  expect(bridge.handshake).toMatchObject({
    ok: true,
    result: { protocol: 1, module: { id: HOSTILE }, capabilities: [] },
  });
  expect(bridge.game).toMatchObject({ ok: true, result: { id: "poe2" } });
  expect(bridge.gameWithSpoofedParams).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  expect(bridge.spoofedStorageRead).toMatchObject({ ok: true, result: null });
  expect(bridge.spoofedStorageWrite).toMatchObject({ ok: true });
  expect(bridge.protoMethod).toMatchObject({ ok: false, error: { code: "UNKNOWN_METHOD" } });
  expect(bridge.constructorMethod).toMatchObject({ ok: false, error: { code: "UNKNOWN_METHOD" } });
  expect(bridge.wrongVersion).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
  expect(bridge.nonJsonValue).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  expect(bridge.oversized).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
  expect(bridge.overQuota).toMatchObject({ ok: false, error: { code: "QUOTA_EXCEEDED" } });
  expect(bridge.traversalKey).toMatchObject({ ok: true });
  expect(bridge.traversalDocument).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  expect(bridge.spoofedDocumentList).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });

  // G9: capabilities that were never granted fail the same way every time.
  for (const [probe, capability] of [
    ["networkFetch", "network"],
    ["filesOpen", "files"],
    ["clipboardRead", "clipboard"],
    ["sharedDataRead", "sharedData"],
  ] as const) {
    expect(bridge[probe], probe).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability } });
  }

  // The "spoofed" write landed in the attacker's own store, not the victim's.
  await panels(page, VANILLA).getByTestId("close").click();
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "count", "2");

  // G7: navigating to another module or the network is refused.
  const before = await inModule<string>(app, HOSTILE, "location.href");
  for (const target of [`tavora-module://${VANILLA}/dist/index.html`, `${serverUrl}/navigate`]) {
    await inModule(app, HOSTILE, `tryNavigate(${JSON.stringify(target)})`);
    await page.waitForTimeout(500);
    expect(await inModule<string>(app, HOSTILE, "location.href")).toBe(before);
  }
  expect(hits).toEqual([]);

  await app.close();
});

test("a crashed module does not take down the host or other modules (G5)", async () => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, HOSTILE);
  await expectModuleText(app, VANILLA, "status", "Connected");
  await expect.poll(() => inModule(app, HOSTILE, "typeof window.runProbes").catch(() => null)).toBe("function");

  // Host UI and both modules must each have their own renderer process,
  // otherwise one crash would take the others with it.
  const pids = await app.evaluate(({ BrowserWindow, webContents }, ids) => {
    const all = webContents.getAllWebContents();
    return {
      host: BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
      modules: ids.map((id) =>
        all.find((contents) => contents.getURL().startsWith(`tavora-module://${id}/`))!.getOSProcessId(),
      ),
    };
  }, [VANILLA, HOSTILE]);
  const [, hostilePid] = pids.modules;
  expect(new Set([pids.host, ...pids.modules]).size).toBe(3);

  // Kill the module's renderer the way a real crash would end it.
  process.kill(hostilePid!, "SIGKILL");

  await expect(panels(page, HOSTILE)).toHaveAttribute("data-status", "crashed");
  await expect(panels(page, HOSTILE).getByTestId("reload")).toBeVisible();

  // The other module keeps working and saving.
  await clickInModule(app, VANILLA, "increment");
  await expectModuleText(app, VANILLA, "count", "1");

  await panels(page, HOSTILE).getByTestId("reload").click();
  await expect(panels(page, HOSTILE)).toHaveAttribute("data-status", "ready");
  await expect.poll(() => inModule(app, HOSTILE, "typeof window.runProbes").catch(() => null)).toBe("function");
  await app.close();
});
