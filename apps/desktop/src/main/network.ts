// network.fetch: web requests the main process makes for a module, to hosts the user granted
// (the decision log, module grants row of 2026-10-16; N1–N7 in the threat model). The module's
// own page still has no network at all (G4); this is the only way out, and every hop is checked.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { LIMITS, type NetworkRequest, type NetworkResponse } from "@tavora/sdk/protocol";
import { isPrivateHost } from "./browser-url";
import { HostError } from "./errors";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_URL = 8192;
const MAX_HEADERS = 50;
const MAX_HEADER_BYTES = 16 * 1024;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Set by the host, or meaningless for a request it makes: refused rather than silently dropped. */
const FORBIDDEN_HEADERS = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Checks what the module sent and gives it a fixed shape. Throws INVALID_PARAMS. */
export function parseNetworkRequest(params: unknown): Required<Omit<NetworkRequest, "body">> & { body: string | undefined } {
  if (typeof params !== "object" || params === null || Array.isArray(params)) throw new HostError("INVALID_PARAMS", "params must be an object");
  const { url, method = "GET", headers = {}, body, responseType = "text", ...rest } = params as Record<string, unknown>;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) throw new HostError("INVALID_PARAMS", `unknown params: ${unknown.join(", ")}`);
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL) throw new HostError("INVALID_PARAMS", "params.url must be a web address");
  if (typeof method !== "string" || !METHODS.has(method)) throw new HostError("INVALID_PARAMS", "params.method must be GET, HEAD, POST, PUT, PATCH or DELETE");
  if (responseType !== "text" && responseType !== "base64") throw new HostError("INVALID_PARAMS", 'params.responseType must be "text" or "base64"');
  if (body !== undefined && typeof body !== "string") throw new HostError("INVALID_PARAMS", "params.body must be text");
  if (body !== undefined && (method === "GET" || method === "HEAD")) throw new HostError("INVALID_PARAMS", `a ${method} request has no body`);
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) throw new HostError("INVALID_PARAMS", "params.headers must be an object of text values");
  const entries = Object.entries(headers);
  if (entries.length > MAX_HEADERS) throw new HostError("INVALID_PARAMS", `at most ${MAX_HEADERS} headers`);
  let size = 0;
  const clean: Record<string, string> = {};
  for (const [name, value] of entries) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name) || typeof value !== "string" || /[\r\n\0]/.test(value)) throw new HostError("INVALID_PARAMS", `header ${name} is not a valid header`);
    if (FORBIDDEN_HEADERS.has(lower) || lower.startsWith("proxy-") || lower.startsWith("sec-")) throw new HostError("INVALID_PARAMS", `header ${name} is set by Tavora`);
    if (lower in clean) throw new HostError("INVALID_PARAMS", `header ${name} is given twice`);
    size += name.length + value.length;
    clean[lower] = value;
  }
  if (size > MAX_HEADER_BYTES) throw new HostError("INVALID_PARAMS", "the headers are too long");
  return { url, method: method as NonNullable<NetworkRequest["method"]>, headers: clean, body, responseType };
}

function ipv4Parts(address: string): number[] {
  return address.split(".").map(Number);
}

/**
 * Whether an IP address is on the public internet: not this PC, the local network, link-local,
 * shared (CGNAT), multicast, documentation, benchmarking or otherwise reserved ranges.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    if (isPrivateHost(address)) return false;
    const [a, b, c] = ipv4Parts(address) as [number, number, number];
    if (a >= 224) return false; // multicast, reserved, broadcast
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol assignments, TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false; // TEST-NET-2, -3
    return true;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (isPrivateHost(`[${lower}]`)) return false;
    // IPv4 written inside IPv6 (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d) is judged as the IPv4 address.
    const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (embedded) return isPublicAddress(embedded[1]!);
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (first === 0x2001 && parseInt(lower.split(":")[1] || "0", 16) === 0x0db8) return false; // documentation
    if (first === 0 || first === 0x0100 || first === 0x2002 || first === 0x64) return false; // unspecified/mapped forms, discard, 6to4, NAT64
    return true;
  }
  return false;
}

/** Test runs only: hosts mapped to a local server, reachable over plain http (TAVORA_TEST_NETWORK_HOSTS). */
export type TestHosts = ReadonlyMap<string, string>;

/** Parses `name=ip,name=ip`. Unpackaged runs only; see index.ts. */
export function parseTestHosts(value: string | undefined): TestHosts {
  const hosts = new Map<string, string>();
  for (const pair of (value ?? "").split(",")) {
    const [name, address] = pair.split("=").map((part) => part.trim());
    if (name && address && isIP(address)) hosts.set(name.toLowerCase(), address);
  }
  return hosts;
}

export interface FetchPolicy {
  /** Hosts the module may reach now; asked again for every redirect. */
  allowedHosts(): ReadonlySet<string>;
  userAgent: string;
  testHosts?: TestHosts;
  /** Tests only: another name resolver. */
  resolve?: typeof dnsLookup;
  /** Tests only: a shorter limit than LIMITS.networkTimeoutMs. */
  timeoutMs?: number;
}

/** Checks one address of a request or redirect against the grant. Throws PERMISSION_DENIED. */
export function checkTarget(raw: string, policy: FetchPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HostError("INVALID_PARAMS", "params.url must be a web address");
  }
  const host = url.hostname.toLowerCase();
  const test = policy.testHosts?.has(host) === true;
  const deny = (why: string) => new HostError("PERMISSION_DENIED", why, { capability: "network" });
  if (url.protocol !== "https:" && !(test && url.protocol === "http:")) throw deny("network.fetch only uses https addresses");
  if (url.username || url.password) throw deny("network.fetch addresses cannot carry a user name or password");
  if (!policy.allowedHosts().has(host)) throw deny(`${host} has not been granted to this module`);
  if (url.port && !test) throw deny("network.fetch only uses the standard https port");
  return url;
}

/** Resolves a name and refuses one that points at this PC or the local network (DNS rebinding included). */
function guardedLookup(testHosts: TestHosts | undefined, resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    const mapped = testHosts?.get(hostname.toLowerCase());
    const finish = (addresses: LookupAddress[]) => {
      if (options.all) (callback as (error: null, addresses: LookupAddress[]) => void)(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    };
    if (mapped) return finish([{ address: mapped, family: isIP(mapped) }]);
    resolve(hostname, { all: true, family: options.family, hints: options.hints }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) {
        const refused = Object.assign(new Error(`${hostname} points to an address on this PC or the local network`), { code: "TAVORA_PRIVATE" });
        return callback(refused, "", 0);
      }
      finish(addresses);
    });
  };
}

function decoded(response: http.IncomingMessage): Readable {
  switch ((response.headers["content-encoding"] ?? "").toLowerCase().trim()) {
    case "gzip":
    case "x-gzip":
      return response.pipe(createGunzip());
    case "deflate":
      return response.pipe(createInflate());
    case "br":
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

function responseHeaders(response: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined || name === "set-cookie" || name === "set-cookie2") continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

interface Hop {
  status: number;
  location: string | undefined;
  headers: Record<string, string>;
  body: Buffer;
}

function send(url: URL, method: string, headers: Record<string, string>, body: string | undefined, policy: FetchPolicy, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method,
        headers: { ...headers, "user-agent": policy.userAgent, "accept-encoding": "gzip, deflate, br", ...(body !== undefined ? { "content-length": Buffer.byteLength(body) } : {}) },
        lookup: guardedLookup(policy.testHosts, policy.resolve),
        agent: false,
        signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = REDIRECTS.has(status) ? response.headers.location : undefined;
        if (location !== undefined || method === "HEAD") {
          response.resume();
          return resolve({ status, location, headers: responseHeaders(response), body: Buffer.alloc(0) });
        }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > LIMITS.maxNetworkResponseBytes) {
          response.destroy();
          return reject(new HostError("QUOTA_EXCEEDED", "the answer is larger than 5 MB"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decoded(response);
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > LIMITS.maxNetworkResponseBytes) {
            stream.destroy();
            response.destroy();
            reject(new HostError("QUOTA_EXCEEDED", "the answer is larger than 5 MB"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, location: undefined, headers: responseHeaders(response), body: Buffer.concat(chunks) }));
        stream.on("error", (error) => reject(error));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function networkError(error: unknown, host: string, signal: AbortSignal, timeoutMs: number): HostError {
  if (error instanceof HostError) return error;
  if ((error as { code?: string }).code === "TAVORA_PRIVATE") return new HostError("PERMISSION_DENIED", (error as Error).message, { capability: "network" });
  if (signal.aborted) return new HostError("NETWORK_ERROR", `${host} did not answer within ${timeoutMs / 1000} seconds`);
  return new HostError("NETWORK_ERROR", `could not reach ${host}`);
}

/** Makes a module's request, following redirects only to granted hosts. */
export async function moduleFetch(params: unknown, policy: FetchPolicy): Promise<NetworkResponse> {
  const request = parseNetworkRequest(params);
  let url = checkTarget(request.url, policy);
  let { method, body } = request;
  let headers = request.headers;
  const timeoutMs = policy.timeoutMs ?? LIMITS.networkTimeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; ; redirects++) {
    let hop: Hop;
    try {
      hop = await send(url, method, headers, body, policy, signal);
    } catch (error) {
      throw networkError(error, url.hostname, signal, timeoutMs);
    }
    if (hop.location === undefined) {
      return { status: hop.status, url: url.href, headers: hop.headers, body: request.responseType === "base64" ? hop.body.toString("base64") : hop.body.toString("utf8") };
    }
    if (redirects >= LIMITS.maxNetworkRedirects) throw new HostError("NETWORK_ERROR", `more than ${LIMITS.maxNetworkRedirects} redirects`);
    let next: URL;
    try {
      next = new URL(hop.location, url);
    } catch {
      throw new HostError("NETWORK_ERROR", "the redirect address is not a web address");
    }
    next = checkTarget(next.href, policy);
    // As browsers do: 303 always, and 301/302 after a POST, continue as a GET without the body.
    if (hop.status === 303 || ((hop.status === 301 || hop.status === 302) && method === "POST")) {
      if (method !== "HEAD") method = "GET";
      body = undefined;
      const { "content-type": _type, ...rest } = headers;
      headers = rest;
    }
    // A sign-in header meant for one host is not handed to another.
    if (next.hostname !== url.hostname) {
      const { authorization: _authorization, ...rest } = headers;
      headers = rest;
    }
    url = next;
  }
}

