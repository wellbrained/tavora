import { BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";
import { LIMITS, type PageResponse } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { checkTarget, type FetchPolicy } from "./network";
import { createPageProxy } from "./page-proxy";

const active = new Set<string>();
const TYPES = new Set(["mainFrame", "script", "stylesheet", "xhr"]);
const CAPTURE = `(() => {
  const html = document.documentElement.outerHTML;
  if (html.length > ${5 * 1024 * 1024}) throw Error('Page exceeds 5 MB');
  return {url: location.href, title: document.title.slice(0, 500), html};
})()`;

/** Fixed read-only page capture. No module JavaScript, user browser state or bridge enters this session. */
export async function moduleReadPage(params: unknown, policy: FetchPolicy, owner: string, cancelled: AbortSignal): Promise<PageResponse> {
  if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).some(key => key !== "url") || typeof (params as {url?:unknown}).url !== "string") throw new HostError("INVALID_PARAMS", "readPage expects a URL");
  const raw = (params as {url:string}).url;
  if (raw.length > 8192) throw new HostError("INVALID_PARAMS", "The page address is too long");
  const url = checkTarget(raw, policy);
  if (url.protocol !== "https:") throw new HostError("PERMISSION_DENIED", "Page imports require HTTPS");
  if (active.has(owner)) throw new HostError("BAD_REQUEST", "A page import is already running for this module");
  active.add(owner);
  const signal = AbortSignal.any([cancelled, AbortSignal.timeout(LIMITS.pageTimeoutMs)]);
  let win: BrowserWindow | undefined;
  let proxy: Awaited<ReturnType<typeof createPageProxy>> | undefined;
  let isolated: ReturnType<typeof session.fromPartition> | undefined;
  const abort = () => { if (win && !win.isDestroyed()) win.destroy(); };
  try {
    if (signal.aborted) throw Error("Page import cancelled");
    isolated = session.fromPartition(`page-import-${randomUUID()}`, { cache: false });
    proxy = await createPageProxy(policy, signal);
    await isolated.setProxy({ proxyRules: `http://127.0.0.1:${proxy.port}`, proxyBypassRules: "<-loopback>" });
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.setDevicePermissionHandler(() => false);
    isolated.on("will-download", event => event.preventDefault());
    let requests = 0, navigations = 0;
    isolated.webRequest.onBeforeRequest((details, callback) => {
      try {
        if (signal.aborted || ++requests > 200 || !TYPES.has(details.resourceType) || !["GET", "HEAD"].includes(details.method)) throw Error("Page request limit");
        checkTarget(details.url, policy);
        if (details.resourceType === "mainFrame" && ++navigations > 6) throw Error("Page redirect limit");
        callback({ cancel: false });
      } catch { callback({ cancel: true }); }
    });
    isolated.webRequest.onHeadersReceived((details, callback) => {
      const size = Number(Object.entries(details.responseHeaders ?? {}).find(([key]) => key.toLowerCase() === "content-length")?.[1]?.[0]);
      callback({ cancel: size > LIMITS.maxNetworkResponseBytes });
    });
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webviewTag: false, webSecurity: true, disableDialogs: true, backgroundThrottling: false,
    } });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    win.webContents.on("will-attach-webview", event => event.preventDefault());
    signal.addEventListener("abort", abort, { once: true });
    let status = 0;
    win.webContents.on("did-navigate", (_event, _url, code) => { status = code; });
    await win.loadURL(url.href);
    const page = await win.webContents.executeJavaScript(CAPTURE) as Omit<PageResponse, "status">;
    checkTarget(page.url, policy);
    if (Buffer.byteLength(page.html, "utf8") > LIMITS.maxNetworkResponseBytes) throw new HostError("QUOTA_EXCEEDED", "The page is larger than 5 MB");
    if (status < 200 || status >= 300 || /^(just a moment|access denied|verify you are human|sign in|log in)/i.test(page.title.trim())) throw new HostError("NETWORK_ERROR", "This page needs sign-in or browser verification. Attach a build file instead.");
    return { ...page, status };
  } catch (error) {
    if (error instanceof HostError) throw error;
    throw new HostError("NETWORK_ERROR", signal.aborted ? "The page import was cancelled or took too long" : "Could not read this public page. Attach a build file instead.");
  } finally {
    signal.removeEventListener("abort", abort);
    abort(); proxy?.close();
    await isolated?.closeAllConnections().catch(() => {});
    await isolated?.clearStorageData().catch(() => {});
    active.delete(owner);
  }
}
