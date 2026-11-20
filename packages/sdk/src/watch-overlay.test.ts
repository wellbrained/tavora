// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchOverlay } from "./index.js";
import { MAX_OVERLAY_CSS, OVERLAY_COLOR_SCHEME_MESSAGE, OVERLAY_CSS_MESSAGE } from "./protocol.js";

class FakeEventSource {
  static last: FakeEventSource | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;
  constructor(readonly url: URL) {
    FakeEventSource.last = this;
  }
  send(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
  close() {
    this.closed = true;
  }
}

const links = () => Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[data-tavora-font]"));

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  document.head.replaceChildren();
});
afterEach(() => vi.unstubAllGlobals());

describe("watchOverlay", () => {
  it("hands over each state, and loads Tavora's font next to the page once per font", () => {
    const seen: unknown[] = [];
    const stop = watchOverlay((state) => seen.push(state));
    const source = FakeEventSource.last!;
    expect(source.url.pathname.endsWith("/_state")).toBe(true);

    source.send({ state: { value: 1 }, font: "inter" });
    source.send({ state: { value: 2 }, font: "inter" });
    expect(seen).toEqual([{ value: 1 }, { value: 2 }]);
    expect(links()).toHaveLength(1);
    expect(links()[0]!.href).toMatch(/\/_font\.css\?font=inter$/);

    // Another font: a new stylesheet, and the old one goes once it is in, so the text never falls back in between.
    source.send({ state: { value: 2 }, font: "allo" });
    expect(links().map((link) => link.dataset.tavoraFont)).toEqual(["inter", "allo"]);
    links()[1]!.dispatchEvent(new Event("load"));
    expect(links().map((link) => link.dataset.tavoraFont)).toEqual(["allo"]);

    // One that fails to load goes, so the same font is tried again with the next message.
    source.send({ state: { value: 3 }, font: "saira" });
    links()[1]!.dispatchEvent(new Event("error"));
    expect(links().map((link) => link.dataset.tavoraFont)).toEqual(["allo"]);
    source.send({ state: { value: 3 }, font: "saira" });
    expect(links().map((link) => link.dataset.tavoraFont)).toEqual(["allo", "saira"]);

    stop();
    expect(source.closed).toBe(true);
  });

  it("leaves the page's fonts alone on a Tavora that sends none", () => {
    const seen: unknown[] = [];
    watchOverlay((state) => seen.push(state));
    FakeEventSource.last!.send({ state: null });
    expect(seen).toEqual([null]);
    expect(links()).toHaveLength(0);
  });

  it("tells the frame it runs in (OBS) the page's colour scheme, again when it changes, and nothing in a window of its own", async () => {
    const posted = vi.spyOn(window, "postMessage");
    watchOverlay(() => undefined)();
    // jsdom's page is its own parent: no frame around it.
    expect(posted).not.toHaveBeenCalled();

    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    let scheme = "dark";
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ colorScheme: scheme }) as CSSStyleDeclaration);
    const stop = watchOverlay(() => undefined);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: OVERLAY_COLOR_SCHEME_MESSAGE, colorScheme: "dark" }, "*");
    // Its own class changes the scheme: the frame hears it once.
    scheme = "light";
    document.documentElement.className = "light";
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.documentElement.className = "light other";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parent.postMessage.mock.calls.map(([message]) => (message as { colorScheme: string }).colorScheme)).toEqual(["dark", "light"]);
    stop();
    document.documentElement.className = "";
    vi.restoreAllMocks();
  });

  it("puts the Custom CSS the frame passes on from OBS into the page, and only from the frame", () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    const stop = watchOverlay(() => undefined);
    const obs = () => document.head.querySelectorAll("style[data-tavora-obs-css]");
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: OVERLAY_CSS_MESSAGE, css: "body { color: red }" } }));
    expect(obs()).toHaveLength(0);
    window.dispatchEvent(new MessageEvent("message", { source: parent as unknown as Window, data: { type: OVERLAY_CSS_MESSAGE, css: "body { color: red }" } }));
    window.dispatchEvent(new MessageEvent("message", { source: parent as unknown as Window, data: { type: OVERLAY_CSS_MESSAGE, css: "body { margin: 0 }" } }));
    expect(Array.from(obs()).map((style) => style.textContent)).toEqual(["body { margin: 0 }"]);
    window.dispatchEvent(new MessageEvent("message", { source: parent as unknown as Window, data: { type: OVERLAY_CSS_MESSAGE, css: "x".repeat(MAX_OVERLAY_CSS + 10) } }));
    expect(obs()[0]!.textContent).toHaveLength(MAX_OVERLAY_CSS);
    stop();
    // Stopped: nothing more comes in.
    window.dispatchEvent(new MessageEvent("message", { source: parent as unknown as Window, data: { type: OVERLAY_CSS_MESSAGE, css: "a {}" } }));
    expect(obs()[0]!.textContent).toHaveLength(MAX_OVERLAY_CSS);
    vi.restoreAllMocks();
  });
});
