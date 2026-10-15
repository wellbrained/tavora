// Which requests a Browser panel's page may make (docs/browser-security.md):
// only web schemes, nothing on this PC or the local network from a public
// page, and no ads or trackers where ad blocking is on.
import { readFileSync } from "node:fs";
import { FiltersEngine, Request, type RequestType } from "@ghostery/adblocker";
import { isPrivateUrl, parseUrl } from "./browser-url";

/** Electron's resource types, as webRequest reports them. */
export type ResourceType =
  | "mainFrame"
  | "subFrame"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "object"
  | "xhr"
  | "ping"
  | "cspReport"
  | "media"
  | "webSocket"
  | "other";

const AD_TYPES: Record<ResourceType, RequestType> = {
  mainFrame: "main_frame",
  subFrame: "sub_frame",
  stylesheet: "stylesheet",
  script: "script",
  image: "image",
  font: "font",
  object: "object",
  xhr: "xmlhttprequest",
  ping: "ping",
  cspReport: "csp_report",
  media: "media",
  webSocket: "websocket",
  other: "other",
};

const SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

export type Verdict = "allow" | "scheme" | "private" | "ad";

export interface RequestInfo {
  url: string;
  resourceType: string;
  /** The address of the page the request belongs to; null when unknown (treated as a public page). */
  topUrl: string | null;
}

export interface AdBlocker {
  /** True when the request matches a blocking rule and no exception. */
  blocks(url: string, sourceUrl: string, type: ResourceType): boolean;
}

/** Loads the engine compiled at build time (scripts/filters.mjs); null when it is missing or unreadable. */
export function loadAdBlocker(file: string): AdBlocker | null {
  let engine: FiltersEngine;
  try {
    engine = FiltersEngine.deserialize(readFileSync(file));
  } catch (error) {
    console.warn(`[tavora] ad blocking is off: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  return adBlocker(engine);
}

export function adBlocker(engine: FiltersEngine): AdBlocker {
  return {
    blocks(url, sourceUrl, type) {
      const { match, redirect } = engine.match(Request.fromRawDetails({ url, sourceUrl, type: AD_TYPES[type] }));
      return match || redirect !== undefined;
    },
  };
}

/**
 * Decides one request. The page the player asked for (the main frame) is
 * never blocked as an ad and never for being local: the address bar and
 * the navigation checks in browser-view.ts decide those.
 */
export function judgeRequest(request: RequestInfo, ads: AdBlocker | null, adblockOn: (topUrl: string) => boolean): Verdict {
  const url = parseUrl(request.url);
  if (!url) return "scheme";
  if (url.protocol === "devtools:") return "allow";
  if (!SCHEMES.has(url.protocol)) return "scheme";
  if (request.resourceType === "mainFrame") return "allow";
  const top = request.topUrl ?? "";
  if (isPrivateUrl(request.url) && !isPrivateUrl(top)) return "private";
  const type = (request.resourceType in AD_TYPES ? request.resourceType : "other") as ResourceType;
  if (ads && top && adblockOn(top) && ads.blocks(request.url, top, type)) return "ad";
  return "allow";
}
