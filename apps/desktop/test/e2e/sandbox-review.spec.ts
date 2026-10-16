// Gate tests added by the sandbox review of 2026-10-16 (docs/threat-model.md,
// "Sandbox review 2026-10-16"). A hostile module tries to hurt the host in ways
// isolation.spec.ts does not cover.

import { createServer } from "node:http";
import dgram from "node:dgram";
import { readdir, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { expectModuleText, HOSTILE, inModule, launch, openModule, panels, VANILLA } from "./harness";

async function hostileReady(app: ElectronApplication): Promise<void> {
  await expect.poll(() => inModule(app, HOSTILE, "typeof window.flood").catch(() => null)).toBe("function");
}

test("a flood of huge bridge messages cannot take down or stall the host (G8)", async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, HOSTILE);
  await hostileReady(app);
  await expectModuleText(app, VANILLA, "status", "Connected");

  const rss = () => app.evaluate(() => Math.round(process.memoryUsage().rss / 1048576));
  const lag = async () => {
    const started = Date.now();
    await app.evaluate(() => Date.now());
    return Date.now() - started;
  };
  const before = await rss();
  const worst: number[] = [];

  // Thousands of small messages, dozens at the size limit, and a few of 400 MB each, which crashed the main process before the relay.
  for (const [count, bytes] of [
    [2000, 200],
    [40, 7_900_000],
    [3, 400_000_000],
  ] as const) {
    const sent = inModule<number>(app, HOSTILE, `flood(${count}, ${bytes})`);
    for (let i = 0; i < 12; i++) worst.push(await lag());
    await sent;
  }

  // The host stayed responsive and its memory did not grow with what the module sent.
  expect(Math.max(...worst), "the host must keep answering").toBeLessThan(1000);
  expect(await rss(), "the host must not hold what the module sent").toBeLessThan(before + 300);

  // The host UI and the other module still work.
  await expect(page.getByTestId("rail")).toBeVisible();
  await expectModuleText(app, VANILLA, "status", "Connected");
  await app.close();
});

test("workers, service workers, WebRTC, WebTransport and frames cannot reach the network (G4)", async () => {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(`http ${request.url}`);
    response.end("reached");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const udp = dgram.createSocket("udp4");
  udp.on("message", (_message, remote) => hits.push(`udp from ${remote.port}`));
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  try {
    const { app, page } = await launch();
    await openModule(page, HOSTILE);
    await hostileReady(app);
    const result = await inModule<Record<string, { ok: boolean; value?: unknown }>>(
      app,
      HOSTILE,
      `moreEscapes(${JSON.stringify({ serverUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, stunUrl: `stun:127.0.0.1:${udp.address().port}` })})`,
    );
    expect(result.serviceWorker?.ok, "no service workers").toBe(false);
    expect(result.worker?.ok, "a worker cannot fetch").toBe(false);
    expect(result.webTransport?.ok, "no WebTransport").toBe(false);
    // Neither the web server nor the UDP (STUN) listener heard anything, whatever the pages said.
    expect(hits).toEqual([]);
    await app.close();
  } finally {
    udp.close();
    server.close();
  }
});

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name);
    total += entry.isDirectory() ? await folderSize(file) : (await stat(file).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

test("a module cannot fill the disk through its own browser storage (G8)", async () => {
  test.setTimeout(120_000);
  // The limit is 256 MB; the test uses 16 MB so it does not have to write that much.
  const { app, page, userData } = await launch(undefined, [], { env: { TAVORA_MODULE_STORAGE_LIMIT_MB: "16" } });
  await openModule(page, HOSTILE);
  await hostileReady(app);

  // The module writes until Tavora stops it. Its renderer is ended, so the call never returns and is not waited for.
  void inModule(app, HOSTILE, "fillStorage('indexeddb', 8, 512)").catch(() => undefined);

  await expect(page.getByTestId("notice")).toContainText("Hostile Test Module");
  await expect(page.getByTestId("notice")).toContainText("cleared");
  // The panel starts again, empty, and what is left on disk is far below what it tried to write.
  await expect(panels(page, HOSTILE)).toHaveAttribute("data-status", "ready", { timeout: 15_000 });
  await expect.poll(() => inModule(app, HOSTILE, "typeof window.fillStorage").catch(() => null)).toBe("function");
  expect(await inModule<number>(app, HOSTILE, "navigator.storage.estimate().then((e) => e.usage)")).toBeLessThan(16 * 1024 * 1024);
  expect(await folderSize(path.join(userData, "Partitions"))).toBeLessThan(64 * 1024 * 1024);
  await app.close();
});
