// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchOverlay } from "./index.js";

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
});
