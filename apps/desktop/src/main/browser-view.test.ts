import { describe, expect, it, vi } from "vitest";

// A Browser panel needs a little of Electron: a page view whose contents report navigations, and a session to lock.
const world = vi.hoisted(() => ({ pairing: [] as ((details: unknown, callback: (response: { confirmed: boolean }) => void) => void)[] }));

vi.mock("electron", () => {
  class Contents {
    static next = 1;
    id = Contents.next++;
    handlers = new Map<string, ((...args: never[]) => void)[]>();
    navigationHistory = { canGoBack: () => false, canGoForward: () => false };
    on(name: string, fn: (...args: never[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
      return this;
    }
    emit(name: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(name) ?? []) (fn as (...a: unknown[]) => void)(...args);
    }
    setWebRTCIPHandlingPolicy() {}
    setWindowOpenHandler() {}
    loadURL = async () => undefined;
    isDestroyed = () => false;
    isLoading = () => false;
    getTitle = () => "";
    close() {}
  }
  class WebContentsView {
    webContents = new Contents();
    setBackgroundColor() {}
    setBorderRadius() {}
    setVisible() {}
    setBounds() {}
  }
  const ses = {
    setUserAgent: () => undefined,
    setSpellCheckerEnabled: () => undefined,
    webRequest: { onBeforeRequest: () => undefined },
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setDevicePermissionHandler: () => undefined,
    setBluetoothPairingHandler: (handler: (typeof world.pairing)[number]) => world.pairing.push(handler),
    setDisplayMediaRequestHandler: () => undefined,
    on: () => undefined,
  };
  return { WebContentsView, session: { fromPartition: () => ses } };
});

const { BrowserPanel, browserSession } = await import("./browser-view");

type Emitting = { emit(name: string, ...args: unknown[]): void };

function panel() {
  const browser = new BrowserPanel({
    instanceId: "browser-1",
    devTools: false,
    background: () => "#000",
    sessionFor: () => ({}) as never,
    isSharedSite: (url) => url.startsWith("https://shared.example/"),
    adblockOn: () => true,
    swap: () => undefined,
    onFocusAddress: () => undefined,
    onOpenTab: () => undefined,
    onCloseTab: () => undefined,
    onAddress: () => undefined,
    onChange: () => undefined,
  });
  const contents = browser.view.webContents as unknown as Emitting;
  const start = (url: string) => contents.emit("did-start-navigation", { url, isMainFrame: true, isSameDocument: false });
  const redirect = (url: string) => contents.emit("will-redirect", { url, isMainFrame: true, preventDefault: () => undefined });
  const commit = (url: string) => contents.emit("did-navigate", {}, url);
  const stop = () => contents.emit("did-stop-loading");
  const fail = (url: string) => contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", url, true);
  return { browser, contents, start, redirect, commit, stop, fail };
}

const LOCAL = "http://localhost:8080/";
const PUBLIC = "https://example.com/";

describe("the address a Browser panel's requests are judged against", () => {
  it("is the new public page from the moment the panel starts going there, not the local page it leaves", () => {
    const { browser, start, commit } = panel();
    start(LOCAL);
    commit(LOCAL);
    expect(browser.topUrl).toBe(LOCAL);
    start(PUBLIC);
    expect(browser.topUrl).toBe(PUBLIC);
    commit(PUBLIC);
    expect(browser.topUrl).toBe(PUBLIC);
  });

  it("follows a public page through its redirects", () => {
    const { browser, start, redirect, commit } = panel();
    commit(LOCAL);
    start("https://short.example/x");
    redirect("https://example.com/long");
    expect(browser.topUrl).toBe("https://example.com/long");
  });

  it("stays the public page while the panel goes from it to a local one", () => {
    const { browser, start, commit } = panel();
    commit(PUBLIC);
    start(LOCAL);
    expect(browser.topUrl).toBe(PUBLIC);
    commit(LOCAL);
    expect(browser.topUrl).toBe(LOCAL);
  });

  it("goes back to the page shown when a navigation stops without a page, or fails", () => {
    const { browser, start, commit, stop, fail } = panel();
    commit(LOCAL);
    // Stopped, a download or a 204: Electron reports no failure, loading just stops.
    start(PUBLIC);
    stop();
    expect(browser.topUrl).toBe(LOCAL);
    start("https://unknown.example/");
    fail("https://unknown.example/");
    expect(browser.topUrl).toBe(LOCAL);
  });

  it("isn't reset by the failure of a navigation that another one replaced", () => {
    const { browser, start, commit, fail } = panel();
    commit(LOCAL);
    start("https://first.example/");
    start(PUBLIC);
    fail("https://first.example/");
    expect(browser.topUrl).toBe(PUBLIC);
  });

  it("ignores navigations of a page view the panel replaced", () => {
    const { browser, contents, commit } = panel();
    commit(LOCAL);
    // A shared site opens in a new view; the old one may still report a navigation.
    browser.navigate("https://shared.example/");
    contents.emit("did-start-navigation", { url: PUBLIC, isMainFrame: true, isSameDocument: false });
    expect(browser.topUrl).toBeNull();
  });
});

describe("a Browser session", () => {
  it("pairs no Bluetooth device", () => {
    browserSession("persist:browser@test", { userAgent: "UA", ads: null, topUrlOf: () => null, adblockOn: () => true, onAdBlocked: () => undefined, onDownloadRefused: () => undefined });
    expect(world.pairing).toHaveLength(1);
    const answers: { confirmed: boolean }[] = [];
    world.pairing[0]!({ deviceId: "d", pairingKind: "confirm", frame: null }, (response) => answers.push(response));
    expect(answers).toEqual([{ confirmed: false }]);
  });
});
