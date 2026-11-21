import { describe, expect, it, vi } from "vitest";

// A Browser panel needs a little of Electron: a page view whose contents report navigations, and a session to lock.
const world = vi.hoisted(() => ({
  pairing: [] as ((details: unknown, callback: (response: { confirmed: boolean }) => void) => void)[],
  /** Every loadURL: which page view, the address and its options. */
  loads: [] as { contents: number; url: string; options: unknown }[],
}));

vi.mock("electron", () => {
  class Contents {
    static next = 1;
    id = Contents.next++;
    handlers = new Map<string, ((...args: never[]) => void)[]>();
    /** Back goes to `back`, when a test sets it. */
    back: string | null = null;
    reloads = 0;
    navigationHistory = {
      canGoBack: () => this.back !== null,
      canGoForward: () => false,
      getActiveIndex: () => 1,
      getEntryAtIndex: (index: number) => (index === 0 && this.back ? { url: this.back, title: "" } : null),
      goBack: () => undefined,
      goForward: () => undefined,
    };
    getURL = () => "";
    reload() {
      this.reloads++;
    }
    on(name: string, fn: (...args: never[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
      return this;
    }
    emit(name: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(name) ?? []) (fn as (...a: unknown[]) => void)(...args);
    }
    setWebRTCIPHandlingPolicy() {}
    openHandler: unknown;
    setWindowOpenHandler(fn: unknown) {
      this.openHandler = fn;
    }
    loadURL = async (url: string, options?: unknown) => {
      world.loads.push({ contents: this.id, url, options });
    };
    isDestroyed = () => false;
    isLoading = () => false;
    getTitle = () => "";
    isCurrentlyAudible = () => false;
    isAudioMuted = () => false;
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

const { BrowserPanel, browserSession, crossSessionStep, pageReferrer } = await import("./browser-view");

type Emitting = { emit(name: string, ...args: unknown[]): void };

/** The sites signed in for all workspaces; a test may change the list. */
const sharedSites = new Set(["https://shared.example/"]);

function panel() {
  const sessions: string[] = [];
  const tabs: unknown[] = [];
  const browser = new BrowserPanel({
    instanceId: "browser-1",
    devTools: false,
    background: () => "#000",
    sessionFor: (kind) => {
      sessions.push(kind);
      return {} as never;
    },
    isSharedSite: (url) => [...sharedSites].some((site) => url.startsWith(site)),
    adblockOn: () => true,
    swap: () => undefined,
    onFocusAddress: () => undefined,
    onOpenTab: (url, background, referrer) => tabs.push({ url, background, referrer }),
    onCloseTab: () => undefined,
    onAddress: () => undefined,
    onChange: () => undefined,
  });
  const contents = browser.view.webContents as unknown as Emitting;
  const start = (url: string, more: { isSameDocument?: boolean; initiator?: unknown } = {}) =>
    contents.emit("did-start-navigation", { url, isMainFrame: true, isSameDocument: false, ...more });
  const redirect = (url: string) => contents.emit("will-redirect", { url, isMainFrame: true, preventDefault: () => undefined });
  const commit = (url: string) => contents.emit("did-navigate", {}, url);
  const stop = () => contents.emit("did-stop-loading");
  const fail = (url: string) => contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", url, true);
  return { browser, contents, start, redirect, commit, stop, fail, sessions, tabs };
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

describe("a navigation that has to move to the other session", () => {
  const referrer = { url: "https://page.example/", policy: "strict-origin" as const };

  it("is carried over when the user started it, or the page did right after a click or key press", () => {
    expect(crossSessionStep({ by: "user" })).toEqual({ action: "reissue", referrer: undefined });
    expect(crossSessionStep({ by: "user", referrer })).toEqual({ action: "reissue", referrer });
    expect(crossSessionStep({ by: "page", gesture: true, referrer })).toEqual({ action: "reissue", referrer });
  });

  it("is left to the user when the page started it by itself", () => {
    expect(crossSessionStep({ by: "page", gesture: false, referrer })).toEqual({ action: "ask" });
  });

  it("is left to the user when Tavora reopened an address by itself, which the page may have chosen", () => {
    expect(crossSessionStep({ by: "restored" })).toEqual({ action: "ask" });
  });

  it("sends the page's origin as the referrer, and nothing for a page off the web", () => {
    expect(pageReferrer("https://page.example/path/to?q=secret#x")).toEqual({ url: "https://page.example/", policy: "strict-origin" });
    expect(pageReferrer("http://page.example:8080/a")).toEqual({ url: "http://page.example:8080/", policy: "strict-origin" });
    expect(pageReferrer(null)).toBeUndefined();
    expect(pageReferrer("about:blank")).toBeUndefined();
    expect(pageReferrer("file:///C:/secret.txt")).toBeUndefined();
  });
});

describe("a Browser panel's page going to a site of the other session", () => {
  const SHARED = "https://shared.example/account";

  function navigating() {
    const made = panel();
    world.loads.length = 0;
    const willNavigate = (url: string) => {
      let prevented = false;
      made.contents.emit("will-navigate", { url, isMainFrame: true, preventDefault: () => (prevented = true) });
      return prevented;
    };
    const click = () => made.contents.emit("input-event", {}, { type: "mouseDown" });
    return { ...made, willNavigate, click };
  }

  it("asks the user when the page goes there by itself, and opens it in that session when they press Open", () => {
    const { browser, commit, willNavigate, sessions } = navigating();
    commit(PUBLIC);
    expect(willNavigate(SHARED)).toBe(true);
    // Nothing loaded: the page's navigation is not turned into Tavora's own.
    expect(world.loads).toEqual([]);
    expect(sessions).toEqual(["workspace"]);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    expect(browser.state.url).toBe(SHARED);

    browser.openAsked();
    expect(sessions).toEqual(["workspace", "shared"]);
    // The user's press, so no referrer, like a typed address.
    expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: SHARED, options: undefined }]);
  });

  it("carries the page there right after a click, with the page's origin as the referrer", () => {
    const { browser, commit, willNavigate, click, sessions } = navigating();
    commit("https://page.example/path?q=1");
    click();
    expect(willNavigate(SHARED)).toBe(true);
    expect(sessions).toEqual(["workspace", "shared"]);
    expect(world.loads).toEqual([
      { contents: browser.view.webContents.id, url: SHARED, options: { httpReferrer: { url: "https://page.example/", policy: "strict-origin" } } },
    ]);
    expect(browser.state.error).toBeNull();
  });

  it("counts the click when Electron reports the navigation before asking about it, as it does", () => {
    // did-start-navigation comes first and takes the click; will-navigate for the same navigation still has it.
    const clicked = navigating();
    clicked.commit("https://page.example/a");
    clicked.click();
    clicked.start(SHARED, { initiator: {} });
    expect(clicked.willNavigate(SHARED)).toBe(true);
    expect(clicked.sessions).toEqual(["workspace", "shared"]);
    expect(world.loads).toEqual([
      { contents: clicked.browser.view.webContents.id, url: SHARED, options: { httpReferrer: { url: "https://page.example/", policy: "strict-origin" } } },
    ]);

    // Without a click, the same order asks.
    const script = navigating();
    script.commit(PUBLIC);
    script.start(SHARED, { initiator: {} });
    expect(script.willNavigate(SHARED)).toBe(true);
    expect(world.loads).toEqual([]);
    expect(script.browser.state.error).toEqual({ kind: "otherSession", detail: "" });
  });

  it("uses a click up once", () => {
    const { browser, commit, willNavigate, click } = navigating();
    commit(PUBLIC);
    click();
    willNavigate(SHARED);
    // The page is in the shared session now; going back to a workspace site by itself needs a click of its own.
    const contents = browser.view.webContents as unknown as Emitting;
    contents.emit("did-navigate", {}, SHARED);
    world.loads.length = 0;
    contents.emit("will-navigate", { url: PUBLIC, isMainFrame: true, preventDefault: () => undefined });
    expect(world.loads).toEqual([]);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
  });

  it("stays on the page when the user says so, and Reload then reloads that page, never the address asked about", () => {
    const { browser, contents, commit, willNavigate, sessions } = navigating();
    commit(PUBLIC);
    willNavigate(SHARED);
    browser.stay();
    expect(browser.state.error).toBeNull();
    expect(browser.state.url).toBe(PUBLIC);
    expect(browser.capturable).toBe(true);

    willNavigate(SHARED);
    browser.reload();
    expect(browser.state.error).toBeNull();
    expect((contents as unknown as { reloads: number }).reloads).toBe(1);
    expect(world.loads).toEqual([]);
    expect(sessions).toEqual(["workspace"]);
  });

  it("asks one thing at a time: Open opens the address shown, not one the page asked for after it", () => {
    const { browser, commit, willNavigate } = navigating();
    commit(PUBLIC);
    willNavigate(SHARED);
    willNavigate("https://shared.example/elsewhere");
    expect(browser.state.url).toBe(SHARED);
    browser.openAsked();
    expect(world.loads.map((load) => load.url)).toEqual([SHARED]);
  });

  it("counts a key press as Windows reports it (rawKeyDown)", () => {
    const { browser, contents, commit, willNavigate, sessions } = navigating();
    commit(PUBLIC);
    contents.emit("input-event", {}, { type: "rawKeyDown" });
    willNavigate(SHARED);
    expect(sessions).toEqual(["workspace", "shared"]);
    expect(browser.state.error).toBeNull();
  });

  it("uses up a click with the page's navigation it came before, so one click lets one address be loaded by Tavora", () => {
    const { browser, commit, click, start, willNavigate } = navigating();
    commit(PUBLIC);
    click();
    // The click takes the page somewhere in its own session.
    start("https://other.example/");
    commit("https://other.example/");
    // A script then sends it to the other session: no click left for that.
    willNavigate(SHARED);
    expect(world.loads).toEqual([]);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
  });

  it("takes only Tavora's own navigation for the user's, even when it stayed within the page", () => {
    // Back to a pushState entry: Tavora's navigation never leaves the page.
    const back = navigating();
    back.commit(PUBLIC);
    (back.contents as unknown as { back: string }).back = "https://example.com/list";
    back.browser.back();
    back.start("https://example.com/list", { isSameDocument: true });
    // Later the page goes to that same address by itself, and is redirected to the other session.
    back.start("https://example.com/list");
    back.redirect(SHARED);
    expect(world.loads).toEqual([]);
    expect(back.browser.state.error).toEqual({ kind: "otherSession", detail: "" });

    // Started by a frame of the page, even to the address Tavora loads: the page's.
    const framed = navigating();
    framed.browser.navigate("https://short.example/x");
    framed.start("https://short.example/x", { initiator: {} });
    world.loads.length = 0;
    framed.redirect(SHARED);
    expect(world.loads).toEqual([]);
    expect(framed.browser.state.error).toEqual({ kind: "otherSession", detail: "" });
  });

  it("lets a page go anywhere in its own session as before", () => {
    const { commit, willNavigate } = navigating();
    commit(PUBLIC);
    expect(willNavigate("https://other.example/")).toBe(false);
    expect(world.loads).toEqual([]);
  });

  it("follows a redirect there only as the navigation it belongs to would", () => {
    // The page's own navigation, no click: the redirect is left to the user.
    const page = navigating();
    page.commit(PUBLIC);
    page.start("https://short.example/x");
    page.redirect(SHARED);
    expect(world.loads).toEqual([]);
    expect(page.browser.state.error).toEqual({ kind: "otherSession", detail: "" });

    // After a click: carried over, with the referrer the page's navigation had.
    const clicked = navigating();
    clicked.commit("https://page.example/a");
    clicked.click();
    clicked.start("https://short.example/x");
    clicked.redirect(SHARED);
    expect(clicked.sessions).toEqual(["workspace", "shared"]);
    expect(world.loads).toEqual([
      { contents: clicked.browser.view.webContents.id, url: SHARED, options: { httpReferrer: { url: "https://page.example/", policy: "strict-origin" } } },
    ]);

    // Typed into the address bar: carried over, with no referrer.
    const typed = navigating();
    typed.browser.navigate("https://short.example/x");
    typed.start("https://short.example/x");
    world.loads.length = 0;
    typed.redirect(SHARED);
    expect(typed.sessions).toEqual(["workspace", "shared"]);
    expect(world.loads).toEqual([{ contents: typed.browser.view.webContents.id, url: SHARED, options: undefined }]);
  });

  it("asks when the address the panel showed last time redirects there, as no click chose it now", () => {
    // A page can put its own address there (it went there, or pushState), and have its server redirect it later.
    const { browser, start, redirect, sessions } = navigating();
    browser.reopen("https://bounce.example/x");
    expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: "https://bounce.example/x", options: undefined }]);
    start("https://bounce.example/x");
    world.loads.length = 0;
    redirect(SHARED);
    expect(world.loads).toEqual([]);
    expect(sessions).toEqual(["workspace"]);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    expect(browser.state.url).toBe(SHARED);

    // Open is the user's press: it opens there.
    browser.openAsked();
    expect(sessions).toEqual(["workspace", "shared"]);
    expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: SHARED, options: undefined }]);
  });

  it("reopens a page of a shared site in the shared session, where it was shown", () => {
    const { browser, sessions } = navigating();
    browser.reopen(SHARED);
    expect(sessions).toEqual(["workspace", "shared"]);
    expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: SHARED, options: undefined }]);
    expect(browser.state.error).toBeNull();
  });

  it("still carries a link the user opened in a new tab through a redirect there", () => {
    const { browser, start, redirect, sessions } = navigating();
    browser.restore("https://short.example/x", { url: "https://page.example/", policy: "strict-origin" });
    start("https://short.example/x");
    world.loads.length = 0;
    redirect(SHARED);
    expect(sessions).toEqual(["workspace", "shared"]);
    expect(world.loads).toEqual([
      { contents: browser.view.webContents.id, url: SHARED, options: { httpReferrer: { url: "https://page.example/", policy: "strict-origin" } } },
    ]);
  });

  it("keeps asking while the page behind the question bounces past the redirect limit or fails", () => {
    const { browser, commit, willNavigate, start, redirect, fail } = navigating();
    commit(PUBLIC);
    willNavigate(SHARED);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    for (let n = 0; n < 10; n++) {
      start(`https://bounce.example/${n}`);
      redirect("https://shared.example/elsewhere");
    }
    fail("https://unknown.example/");
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    expect(browser.state.url).toBe(SHARED);
    expect(world.loads).toEqual([]);
    browser.openAsked();
    expect(world.loads.map((load) => load.url)).toEqual([SHARED]);
  });

  it("asks again on Try again when the address that failed redirects there, as the page may have chosen it", () => {
    const { browser, contents, commit, start, redirect, fail, sessions } = navigating();
    commit(PUBLIC);
    start("https://bounce.example/x");
    fail("https://bounce.example/x");
    expect(browser.state.error).toEqual({ kind: "notFound", detail: "" });
    browser.reload();
    expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: "https://bounce.example/x", options: undefined }]);
    start("https://bounce.example/x");
    world.loads.length = 0;
    redirect(SHARED);
    expect(world.loads).toEqual([]);
    expect(sessions).toEqual(["workspace"]);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    expect((contents as unknown as { reloads: number }).reloads).toBe(0);
  });

  it("asks on Try again before it opens an address of the other session", () => {
    const { browser, commit, fail, sessions } = navigating();
    commit(PUBLIC);
    // What failed is an address of the shared site (a page's bounce between the sessions that went on too long).
    fail(SHARED);
    browser.reload();
    expect(world.loads).toEqual([]);
    expect(sessions).toEqual(["workspace"]);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    expect(browser.state.url).toBe(SHARED);
  });

  it("asks when Back, Forward or Reload goes to an address of the page's history that redirects there", () => {
    // Back to an entry the page made itself.
    const back = navigating();
    back.commit(PUBLIC);
    (back.contents as unknown as { back: string }).back = "https://bounce.example/b";
    back.browser.back();
    back.start("https://bounce.example/b");
    back.redirect(SHARED);
    expect(world.loads).toEqual([]);
    expect(back.sessions).toEqual(["workspace"]);
    expect(back.browser.state.error).toEqual({ kind: "otherSession", detail: "" });

    // Reload of the page it went to by itself.
    const reload = navigating();
    reload.commit("https://bounce.example/r");
    (reload.contents as unknown as { getURL: () => string }).getURL = () => "https://bounce.example/r";
    reload.browser.reload();
    reload.start("https://bounce.example/r");
    reload.redirect(SHARED);
    expect(world.loads).toEqual([]);
    expect(reload.sessions).toEqual(["workspace"]);
    expect(reload.browser.state.error).toEqual({ kind: "otherSession", detail: "" });
  });

  it("keeps asking when the page behind the question goes elsewhere in its own session, and Stay then shows it there", () => {
    const { browser, commit, willNavigate, start } = navigating();
    commit(PUBLIC);
    willNavigate(SHARED);
    start("https://other.example/");
    commit("https://other.example/");
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    expect(browser.state.url).toBe(SHARED);
    expect(browser.capturable).toBe(false);
    browser.stay();
    expect(browser.state.error).toBeNull();
    expect(browser.state.url).toBe("https://other.example/");
  });

  it("keeps asking when a Browser site list changes, and never opens the address asked about without Open", () => {
    const { browser, start, redirect, sessions } = navigating();
    browser.reopen("https://bounce.example/x");
    start("https://bounce.example/x");
    redirect(SHARED);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    world.loads.length = 0;
    browser.siteSettingsChanged();
    expect(sessions).toEqual(["workspace"]);
    expect(world.loads).toEqual([]);
    expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    expect(browser.state.url).toBe(SHARED);

    // The asked site leaves the shared list: the question stays, and Open opens it in the session it belongs in then.
    sharedSites.delete("https://shared.example/");
    try {
      browser.siteSettingsChanged();
      expect(world.loads).toEqual([]);
      expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
      browser.openAsked();
      expect(sessions).toEqual(["workspace"]);
      expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: SHARED, options: undefined }]);
    } finally {
      sharedSites.add("https://shared.example/");
    }
  });

  it("moves a page the user opened to the other session when its site moves there, as before", () => {
    const { browser, start, commit, sessions } = navigating();
    browser.navigate("https://moving.example/a");
    start("https://moving.example/a");
    commit("https://moving.example/a");
    world.loads.length = 0;
    sharedSites.add("https://moving.example/");
    try {
      browser.siteSettingsChanged();
      expect(sessions).toEqual(["workspace", "shared"]);
      expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: "https://moving.example/a", options: undefined }]);
      expect(browser.state.error).toBeNull();
    } finally {
      sharedSites.delete("https://moving.example/");
    }
  });

  /** Runs `test` with `site` on the shared list. */
  function withShared(site: string, test: () => void) {
    sharedSites.add(site);
    try {
      test();
    } finally {
      sharedSites.delete(site);
    }
  }

  it("moves any other page there by its site's home, without asking, as the user chose the site and not the address", () => {
    const MOVING = "https://moving.example/mail/inbox?id=7";
    const ways: Record<string, (made: ReturnType<typeof navigating>) => void> = {
      reopened: ({ browser, start, commit }) => {
        browser.reopen(MOVING);
        start(MOVING);
        commit(MOVING);
      },
      "gone to by the page": ({ start, commit }) => {
        commit(PUBLIC);
        start(MOVING);
        commit(MOVING);
      },
      "a link the user clicked": ({ start, commit, click }) => {
        commit(PUBLIC);
        click();
        start(MOVING);
        commit(MOVING);
      },
      "redirected to from a typed address": ({ browser, start, redirect, commit }) => {
        browser.navigate("https://short.example/x");
        start("https://short.example/x");
        redirect(MOVING);
        commit(MOVING);
      },
      reloaded: ({ browser, contents, start, commit }) => {
        commit(MOVING);
        (contents as unknown as { getURL: () => string }).getURL = () => MOVING;
        browser.reload();
        start(MOVING);
        commit(MOVING);
      },
      "gone back to": ({ browser, contents, start, commit }) => {
        commit(PUBLIC);
        (contents as unknown as { back: string }).back = MOVING;
        browser.back();
        start(MOVING);
        commit(MOVING);
      },
      "typed, then changed by the page": ({ browser, contents, start, commit }) => {
        browser.navigate("https://moving.example/a");
        start("https://moving.example/a");
        commit("https://moving.example/a");
        contents.emit("did-navigate-in-page", {}, MOVING, true);
      },
    };
    for (const [way, go] of Object.entries(ways)) {
      const made = navigating();
      go(made);
      world.loads.length = 0;
      withShared("https://moving.example/", () => {
        made.browser.siteSettingsChanged();
        expect(made.sessions, way).toEqual(["workspace", "shared"]);
        expect(world.loads, way).toEqual([{ contents: made.browser.view.webContents.id, url: "https://moving.example/", options: undefined }]);
        expect(made.browser.state.error, way).toBeNull();
      });
    }
  });

  it("moves a page a click carried to the other session back by its site's home, not the address the page chose", () => {
    const { browser, commit, willNavigate, click, sessions } = navigating();
    commit("https://page.example/a");
    click();
    willNavigate(SHARED);
    const contents = browser.view.webContents as unknown as Emitting;
    contents.emit("did-start-navigation", { url: SHARED, isMainFrame: true, isSameDocument: false });
    contents.emit("did-navigate", {}, SHARED);
    world.loads.length = 0;
    sharedSites.delete("https://shared.example/");
    try {
      browser.siteSettingsChanged();
      expect(sessions).toEqual(["workspace", "shared", "workspace"]);
      expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: "https://shared.example/", options: undefined }]);
    } finally {
      sharedSites.add("https://shared.example/");
    }
  });

  it("moves a page that failed before anything opened by its site's home", () => {
    const { browser, start, fail, sessions } = navigating();
    browser.reopen("https://moving.example/a?x");
    start("https://moving.example/a?x");
    fail("https://moving.example/a?x");
    expect(browser.state.error).toEqual({ kind: "notFound", detail: "" });
    world.loads.length = 0;
    withShared("https://moving.example/", () => {
      browser.siteSettingsChanged();
      expect(sessions).toEqual(["workspace", "shared"]);
      expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: "https://moving.example/", options: undefined }]);
    });
  });

  it("moves the page behind the question once the user stays, when its site moved while the panel asked", () => {
    const { browser, commit, willNavigate, sessions } = navigating();
    commit("https://moving.example/inbox?id=7");
    willNavigate(SHARED);
    world.loads.length = 0;
    withShared("https://moving.example/", () => {
      browser.siteSettingsChanged();
      expect(world.loads).toEqual([]);
      expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
      browser.stay();
      expect(sessions).toEqual(["workspace", "shared"]);
      expect(world.loads).toEqual([{ contents: browser.view.webContents.id, url: "https://moving.example/", options: undefined }]);
      expect(browser.state.error).toBeNull();
    });
  });

  it("shows whether the site asked about is shared from the list, and hands only the page's own address to the system browser", () => {
    const { browser, commit, willNavigate } = navigating();
    commit(PUBLIC);
    expect(browser.state.shared).toBe(false);
    willNavigate(SHARED);
    expect(browser.asking).toBe(true);
    expect(browser.state.shared).toBe(true);
    expect(browser.externalUrl).toBe(PUBLIC);

    const reopened = navigating();
    reopened.browser.reopen("https://bounce.example/x");
    reopened.start("https://bounce.example/x");
    reopened.redirect(SHARED);
    expect(reopened.browser.externalUrl).toBeNull();
  });

  it("forgets its own load that stopped or failed before it started, so a later navigation of the page can't take its start", () => {
    for (const end of ["stop", "fail"] as const) {
      const { browser, start, redirect, stop, fail, sessions } = navigating();
      browser.navigate("https://short.example/x");
      // A beforeunload of the page cancelled it: Chromium never reported its start.
      if (end === "stop") stop();
      else fail("https://short.example/x");
      // Later the page goes to that address by itself and is redirected to the other session.
      start("https://short.example/x");
      world.loads.length = 0;
      redirect(SHARED);
      expect(world.loads).toEqual([]);
      expect(sessions).toEqual(["workspace"]);
      expect(browser.state.error).toEqual({ kind: "otherSession", detail: "" });
    }
  });

  it("hands a new tab the referrer Chromium worked out for the page", async () => {
    const { contents, commit, click, tabs } = navigating();
    commit("https://page.example/a");
    const open = (contents as unknown as { openHandler: (details: unknown) => { action: string } }).openHandler;
    click();
    expect(open({ url: SHARED, disposition: "foreground-tab", referrer: { url: "https://page.example/a", policy: "strict-origin-when-cross-origin" } })).toEqual({ action: "deny" });
    click();
    open({ url: PUBLIC, disposition: "background-tab", referrer: { url: "", policy: "no-referrer" } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(tabs).toEqual([
      { url: SHARED, background: false, referrer: { url: "https://page.example/a", policy: "strict-origin-when-cross-origin" } },
      { url: PUBLIC, background: true, referrer: undefined },
    ]);
  });
});
