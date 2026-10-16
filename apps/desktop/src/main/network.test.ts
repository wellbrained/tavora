import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { LIMITS } from "@tavora/sdk/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostError } from "./errors";
import { checkTarget, isPublicAddress, moduleFetch, parseNetworkRequest, parseTestHosts, type FetchPolicy } from "./network";

/** What the test server saw of the last request. */
let seen: { method?: string | undefined; url?: string | undefined; host?: string | undefined; headers: http.IncomingHttpHeaders; body: string } = { headers: {}, body: "" };
let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      seen = { method: request.method, url: request.url, host: request.headers.host, headers: request.headers, body };
      const url = new URL(request.url ?? "/", "http://x");
      const host = request.headers.host?.split(":")[0];
      switch (url.pathname) {
        case "/text":
          response.writeHead(200, { "content-type": "text/plain", "set-cookie": "a=1", "x-extra": "yes" });
          return response.end("hello ü");
        case "/echo":
          response.writeHead(200, { "content-type": "application/json" });
          return response.end(JSON.stringify({ method: request.method, body, host }));
        case "/png":
          response.writeHead(200, { "content-type": "image/png" });
          return response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        case "/missing":
          response.writeHead(404);
          return response.end("nope");
        case "/to-granted":
          response.writeHead(302, { location: `http://cdn.tavora.test:${port}/echo` });
          return response.end();
        case "/to-ungranted":
          response.writeHead(302, { location: `http://evil.tavora.test:${port}/echo` });
          return response.end();
        case "/to-https-port":
          response.writeHead(307, { location: "https://cdn.tavora.test:8443/echo" });
          return response.end();
        case "/see-other":
          response.writeHead(303, { location: "/echo" });
          return response.end();
        case "/keep-method":
          response.writeHead(307, { location: "/echo" });
          return response.end();
        case "/loop":
          response.writeHead(302, { location: "/loop" });
          return response.end();
        case "/big-declared":
          response.writeHead(200, { "content-length": String(LIMITS.maxNetworkResponseBytes + 1) });
          return response.end();
        case "/big-streamed": {
          response.writeHead(200);
          const chunk = Buffer.alloc(1024 * 1024, 97);
          for (let i = 0; i < 6; i++) response.write(chunk);
          return response.end();
        }
        case "/bomb":
          response.writeHead(200, { "content-encoding": "gzip" });
          return response.end(gzipSync(Buffer.alloc(LIMITS.maxNetworkResponseBytes + 1024, 0)));
        case "/gzip":
          response.writeHead(200, { "content-encoding": "gzip" });
          return response.end(gzipSync(Buffer.from("packed")));
        case "/slow":
          return; // never answers
        default:
          response.writeHead(500);
          response.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const TEST_HOSTS = parseTestHosts("api.tavora.test=127.0.0.1, cdn.tavora.test=127.0.0.1, evil.tavora.test=127.0.0.1");

function policy(hosts = ["api.tavora.test", "cdn.tavora.test"], extra: Partial<FetchPolicy> = {}): FetchPolicy {
  const allowed = new Set(hosts);
  return { allowedHosts: () => allowed, userAgent: "Tavora/0.0.0-test (module community.someone.tracker)", testHosts: TEST_HOSTS, ...extra };
}

const at = (path: string, host = "api.tavora.test") => `http://${host}:${port}${path}`;

async function failure(promise: Promise<unknown>): Promise<HostError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HostError) return error;
    throw error;
  }
  throw new Error("expected a HostError");
}

describe("moduleFetch", () => {
  it("answers with the status, final address, headers without cookies, and the body as text", async () => {
    const response = await moduleFetch({ url: at("/text") }, policy());
    expect(response).toMatchObject({ status: 200, url: at("/text"), body: "hello ü" });
    expect(response.headers).toMatchObject({ "content-type": "text/plain", "x-extra": "yes" });
    expect(response.headers).not.toHaveProperty("set-cookie");
  });

  it("sends Tavora's user agent, the module's own headers and no cookies", async () => {
    await moduleFetch({ url: at("/echo"), headers: { "X-Api-Key": "k", Accept: "application/json" } }, policy());
    expect(seen.headers).toMatchObject({ "user-agent": "Tavora/0.0.0-test (module community.someone.tracker)", "x-api-key": "k", accept: "application/json" });
    expect(seen.headers.cookie).toBeUndefined();
  });

  it("sends a body with POST", async () => {
    const response = await moduleFetch({ url: at("/echo"), method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } }, policy());
    expect(JSON.parse(response.body)).toEqual({ method: "POST", body: '{"a":1}', host: "api.tavora.test" });
  });

  it("returns binary answers as base64 when asked", async () => {
    expect((await moduleFetch({ url: at("/png"), responseType: "base64" }, policy())).body).toBe("iVBORw==");
  });

  it("returns an error status as an answer, not an error", async () => {
    expect(await moduleFetch({ url: at("/missing") }, policy())).toMatchObject({ status: 404, body: "nope" });
  });

  it("unpacks compressed answers", async () => {
    expect((await moduleFetch({ url: at("/gzip") }, policy())).body).toBe("packed");
  });

  it("follows a redirect to another granted host, without the Authorization header", async () => {
    const response = await moduleFetch({ url: at("/to-granted"), headers: { authorization: "Bearer secret" } }, policy());
    expect(response).toMatchObject({ status: 200, url: at("/echo", "cdn.tavora.test") });
    expect(seen.host).toBe(`cdn.tavora.test:${port}`);
    expect(seen.headers.authorization).toBeUndefined();
  });

  it("keeps the Authorization header on a redirect within the same host", async () => {
    await moduleFetch({ url: at("/keep-method"), headers: { authorization: "Bearer secret" } }, policy());
    expect(seen.headers.authorization).toBe("Bearer secret");
  });

  it("refuses a redirect to a host that was not granted", async () => {
    const error = await failure(moduleFetch({ url: at("/to-ungranted") }, policy()));
    expect(error).toMatchObject({ code: "PERMISSION_DENIED", extra: { capability: "network" } });
    expect(error.message).toContain("evil.tavora.test");
  });

  it("refuses a redirect to a non-standard https port", async () => {
    const onlyApiIsLocal = policy(undefined, { testHosts: parseTestHosts("api.tavora.test=127.0.0.1") });
    const error = await failure(moduleFetch({ url: at("/to-https-port") }, onlyApiIsLocal));
    expect(error).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(error.message).toContain("standard https port");
  });

  it("checks the grant again on every redirect, so a revoke takes effect at once", async () => {
    const allowed = new Set(["api.tavora.test", "cdn.tavora.test"]);
    let calls = 0;
    const revoking: FetchPolicy = { ...policy(), allowedHosts: () => (++calls > 1 ? new Set<string>() : allowed) };
    expect(await failure(moduleFetch({ url: at("/to-granted") }, revoking))).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("turns a POST into a GET without its body after 303, and keeps it after 307", async () => {
    await moduleFetch({ url: at("/see-other"), method: "POST", body: "x" }, policy());
    expect(seen).toMatchObject({ method: "GET", body: "" });
    await moduleFetch({ url: at("/keep-method"), method: "POST", body: "x" }, policy());
    expect(seen).toMatchObject({ method: "POST", body: "x" });
  });

  it("stops after too many redirects", async () => {
    expect(await failure(moduleFetch({ url: at("/loop") }, policy()))).toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("refuses answers over 5 MB, declared, streamed or unpacked", async () => {
    for (const path of ["/big-declared", "/big-streamed", "/bomb"]) {
      expect(await failure(moduleFetch({ url: at(path) }, policy())), path).toMatchObject({ code: "QUOTA_EXCEEDED" });
    }
  });

  it("gives up on a host that does not answer in time", async () => {
    const error = await failure(moduleFetch({ url: at("/slow") }, policy(undefined, { timeoutMs: 300 })));
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect(error.message).toContain("did not answer");
  });

  it("reports a host that cannot be reached as NETWORK_ERROR", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const free = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    expect(await failure(moduleFetch({ url: `http://api.tavora.test:${free}/` }, policy()))).toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("refuses a granted name that resolves to this PC or the local network (DNS rebinding)", async () => {
    for (const address of ["127.0.0.1", "192.168.1.20", "::1", "169.254.169.254"]) {
      const resolve = ((_name: string, _options: unknown, callback: (error: null, addresses: { address: string; family: number }[]) => void) =>
        callback(null, [{ address, family: address.includes(":") ? 6 : 4 }])) as unknown as NonNullable<FetchPolicy["resolve"]>;
      const error = await failure(moduleFetch({ url: "https://api.example.com/" }, policy(["api.example.com"], { testHosts: new Map(), resolve })));
      expect(error, address).toMatchObject({ code: "PERMISSION_DENIED", extra: { capability: "network" } });
      expect(error.message).toContain("local network");
    }
  });
});

describe("checkTarget", () => {
  const grant = policy(["api.example.com"], { testHosts: new Map() });

  it("allows a granted https address on the standard port", () => {
    expect(checkTarget("https://api.example.com/v1?q=1", grant).href).toBe("https://api.example.com/v1?q=1");
    expect(checkTarget("https://API.example.com:443/", grant).hostname).toBe("api.example.com");
  });

  it.each([
    ["http://api.example.com/", "https"],
    ["https://other.example.com/", "has not been granted"],
    ["https://sub.api.example.com/", "has not been granted"],
    ["https://api.example.com.evil.test/", "has not been granted"],
    ["https://api.example.com:8443/", "standard https port"],
    ["https://user:pw@api.example.com/", "user name or password"],
    ["file:///etc/passwd", "https"],
    ["https://127.0.0.1/", "has not been granted"],
  ])("refuses %s", (url, why) => {
    let error: unknown;
    try {
      checkTarget(url, grant);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "PERMISSION_DENIED" });
    expect((error as Error).message).toContain(why);
  });

  it("allows plain http only for test hosts", () => {
    expect(checkTarget(`http://api.tavora.test:${port}/`, policy()).protocol).toBe("http:");
  });
});

describe("parseNetworkRequest", () => {
  it("fills in GET, no headers and text", () => {
    expect(parseNetworkRequest({ url: "https://a.example/" })).toEqual({ url: "https://a.example/", method: "GET", headers: {}, body: undefined, responseType: "text" });
  });

  it("lowercases header names", () => {
    expect(parseNetworkRequest({ url: "https://a.example/", headers: { "X-Key": "v" } }).headers).toEqual({ "x-key": "v" });
  });

  it.each([
    [{ url: "" }, "params.url"],
    [{ url: "https://a.example/", method: "CONNECT" }, "params.method"],
    [{ url: "https://a.example/", body: "x" }, "no body"],
    [{ url: "https://a.example/", method: "POST", body: 7 }, "params.body"],
    [{ url: "https://a.example/", responseType: "blob" }, "responseType"],
    [{ url: "https://a.example/", headers: { Cookie: "a=1" } }, "set by Tavora"],
    [{ url: "https://a.example/", headers: { Host: "evil.example" } }, "set by Tavora"],
    [{ url: "https://a.example/", headers: { "Proxy-Authorization": "x" } }, "set by Tavora"],
    [{ url: "https://a.example/", headers: { "Sec-Fetch-Site": "x" } }, "set by Tavora"],
    [{ url: "https://a.example/", headers: { "User-Agent": "x" } }, "set by Tavora"],
    [{ url: "https://a.example/", headers: { "X-A": "1\r\nX-B: 2" } }, "not a valid header"],
    [{ url: "https://a.example/", headers: { "bad name": "1" } }, "not a valid header"],
    [{ url: "https://a.example/", headers: { "X-A": "1", "x-a": "2" } }, "twice"],
    [{ url: "https://a.example/", headers: ["x"] }, "params.headers"],
    [{ url: "https://a.example/", cache: "no-store" }, "unknown params"],
    [null, "must be an object"],
  ])("refuses %j", (params, why) => {
    let error: unknown;
    try {
      parseNetworkRequest(params);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "INVALID_PARAMS" });
    expect((error as Error).message).toContain(why);
  });
});

describe("isPublicAddress", () => {
  it.each(["93.184.216.34", "1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001:82a::200e"])("%s is public", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "198.18.0.1",
    "203.0.113.5",
    "::",
    "::1",
    "fe80::1",
    "fd00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "2002:7f00:1::",
    "not an address",
  ])("%s is not public", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("parseTestHosts", () => {
  it("reads name=address pairs and skips anything else", () => {
    expect([...parseTestHosts("A.tavora.test=127.0.0.1,bad,b.tavora.test=nope, c.tavora.test = ::1")]).toEqual([
      ["a.tavora.test", "127.0.0.1"],
      ["c.tavora.test", "::1"],
    ]);
    expect(parseTestHosts(undefined).size).toBe(0);
  });
});
