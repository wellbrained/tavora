// Address rules of the Browser panel (docs/browser-security.md). Pure
// functions only, so every rule is unit tested without Electron.
import { domainToUnicode } from "node:url";
import { getDomain } from "tldts";

/** Where a typed search goes. Only the typed text is sent. */
export const SEARCH_URL = "https://duckduckgo.com/?q=";
/** Longest address the toolbar may send, in characters. */
export const MAX_ADDRESS = 2048;

/** Parses a URL, or null. */
export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Only http and https pages are ever shown at the top level of a panel. */
export function isWebUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return url !== null && (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
}

const HOST_LIKE = /^(?:\[[0-9a-f:.]+\]|[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.?)(?::\d{1,5})?(?:[/?#]\S*)?$/iu;

/**
 * What the address bar opens for what the player typed: the address itself
 * when it is http or https, `https://` plus the text when it looks like a
 * host name (http for a local address, which rarely has a certificate), and a
 * search otherwise. Never anything but an http or https address.
 */
export function addressToUrl(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > MAX_ADDRESS) return null;
  if (/^https?:\/\//i.test(text)) return isWebUrl(text) ? parseUrl(text)!.href : null;
  if (!/\s/.test(text) && HOST_LIKE.test(text)) {
    const host = text.split(/[/?#]/)[0]!;
    const looksLikeHost = host.includes(".") || /^localhost(?::\d+)?$/i.test(host) || host.startsWith("[");
    // "foo:bar" is a scheme, not a host and port: search it.
    if (looksLikeHost && !/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) {
      const probe = parseUrl(`http://${text}`);
      if (probe && probe.hostname) {
        const scheme = isPrivateHost(probe.hostname) ? "http" : "https";
        const url = parseUrl(`${scheme}://${text}`);
        if (url && isWebUrl(url.href)) return url.href;
      }
    }
  }
  return SEARCH_URL + encodeURIComponent(text);
}

function ipv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((n) => n >= 0 && n <= 255) ? numbers : null;
}

function privateIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Whether a host name (as `URL.hostname` gives it) points at this PC or the
 * local network: loopback, private and link-local ranges, `localhost` and
 * `.local` names. Names that resolve to such an address are not caught (see
 * DNS rebinding in docs/browser-security.md).
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const v4 = ipv4(host);
  if (v4) return privateIpv4(v4);
  if (!host.startsWith("[")) return false;
  const v6 = host.slice(1, -1);
  if (v6 === "::" || v6 === "::1") return true;
  // IPv4-mapped (::ffff:7f00:1, as the URL parser writes ::ffff:127.0.0.1).
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16);
    const low = parseInt(mapped[2]!, 16);
    return privateIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  const first = parseInt(v6.split(":")[0] || "0", 16);
  // fc00::/7 unique local, fe80::/10 link-local.
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/** Whether a page address is on this PC or the local network. */
export function isPrivateUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return url !== null && isPrivateHost(url.hostname);
}

/**
 * The site a host belongs to, as the player marks it for shared sign-in or
 * ad blocking: its registrable domain (`wiki.example.co.uk` is
 * `example.co.uk`), or the host itself for addresses and local names.
 */
export function siteOf(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateHost(host) || ipv4(host) || host.startsWith("[")) return host;
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

/** The site of a page address, or null for anything but http and https. */
export function siteOfUrl(raw: string): string | null {
  return isWebUrl(raw) ? siteOf(parseUrl(raw)!.hostname) : null;
}

/** A site as stored in the library: what siteOf returns, nothing longer than a host name can be. */
export function isSite(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 253 && siteOf(value) === value && parseUrl(`https://${value}/`)?.hostname === value;
}

/**
 * The host as the toolbar shows it. A label with letters from any script
 * but Latin is shown as punycode, so `аpple.com` (Cyrillic а) cannot pass
 * for `apple.com`; `müller.de` stays readable.
 */
export function displayHost(hostname: string): string {
  return hostname
    .split(".")
    .map((label) => {
      if (!label.startsWith("xn--")) return label;
      const unicode = domainToUnicode(label);
      if (!unicode || unicode === label) return label;
      return [...unicode].every((char) => /[\p{Script=Latin}\p{N}-]/u.test(char)) ? unicode : label;
    })
    .join(".");
}
