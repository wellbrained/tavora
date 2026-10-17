// Network grants (the threat model, N1–N7): a module reaches the hosts the player granted
// through network.fetch, nothing else, and its page still has no network of its own.

import { writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { desktopDir, inModule, launch, newUserData, openModule } from "./harness";

const NETWORK = "local.test.network-module";
const FIXTURE = path.join(desktopDir, "test/network-fixture");

let server: Server;
let port: number;
const seen: { host: string | undefined; path: string | undefined; headers: IncomingHttpHeaders }[] = [];

test.beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({ host: request.headers.host, path: request.url, headers: request.headers });
    response.writeHead(200, { "content-type": "application/json", "set-cookie": "tracker=1" });
    response.end(JSON.stringify({ hello: "from the server" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

interface Reply {
  ok?: boolean;
  result?: { status: number; url: string; headers: Record<string, string>; body: string; capabilities?: string[] };
  error?: { code: string; capability?: string; message: string };
}

test("a module reaches only the hosts the player granted, through Tavora", async () => {
  const userData = await newUserData();
  // The player granted both hosts the module asks for (the consent dialog itself is tested in grants.spec.ts,
  // and a host asked for but not granted with the Review bar there).
  await writeFile(
    path.join(userData, "grants.json"),
    JSON.stringify({ version: 1, owners: { local: { [NETWORK]: { version: "0.0.0", grantedAt: "2026-10-16T20:00:00.000Z", network: ["api.tavora.test", "cdn.tavora.test"] } } } }),
  );
  const { app, page } = await launch(userData, [FIXTURE], {
    env: { TAVORA_TEST_NETWORK_HOSTS: "api.tavora.test=127.0.0.1,cdn.tavora.test=127.0.0.1,evil.tavora.test=127.0.0.1" },
  });
  await openModule(page, NETWORK);
  await expect.poll(() => inModule<Reply>(app, NETWORK, "window.handshake?.()").catch(() => null)).toMatchObject({ ok: true, result: { capabilities: ["network"] } });

  const request = (url: string) => inModule<Reply>(app, NETWORK, `window.request(${JSON.stringify({ url, headers: { "x-module": "yes" } })})`);

  // The granted host answers, through the main process: Tavora's user agent, no cookies either way.
  const granted = await request(`http://api.tavora.test:${port}/v1/data`);
  expect(granted).toMatchObject({ ok: true, result: { status: 200, body: JSON.stringify({ hello: "from the server" }) } });
  expect(granted.result!.headers["set-cookie"]).toBeUndefined();
  expect(seen.at(-1)).toMatchObject({ host: `api.tavora.test:${port}`, path: "/v1/data" });
  expect(seen.at(-1)!.headers).toMatchObject({ "x-module": "yes" });
  expect(seen.at(-1)!.headers["user-agent"]).toMatch(/^Tavora\/.+ \(module local\.test\.network-module\)$/);
  expect(seen.at(-1)!.headers.cookie).toBeUndefined();

  // A host the module never asked for is refused before anything leaves the PC.
  const before = seen.length;
  expect(await request(`http://evil.tavora.test:${port}/`)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability: "network" } });
  expect(seen.length).toBe(before);

  // The page itself still reaches nothing (G4), granted or not.
  expect(await inModule(app, NETWORK, `window.directFetch(${JSON.stringify(`http://127.0.0.1:${port}/direct`)})`)).toBe("blocked");
  expect(seen.length).toBe(before);

  await app.close();
});
