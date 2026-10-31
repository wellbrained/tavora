import { describe, expect, it, vi } from "vitest";
import { LIMITS, MIN_TAVORA, TavoraError } from "./index.js";
import { createMemoryHost, LATEST_TAVORA } from "./testing.js";

const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

describe("handshake", () => {
  it("reports the module, the granted capabilities and the Tavora version", async () => {
    const { sdk, host } = createMemoryHost({ panelType: "editor", capabilities: ["network"] });
    expect(sdk.host).toEqual({
      protocol: 1,
      host: { name: "tavora-desktop", version: LATEST_TAVORA },
      module: { id: "local.test.module", version: "1.0.0" },
      capabilities: ["network"],
      panel: { type: "editor" },
    });
    expect(sdk.panel.type).toBe("editor");
    expect(host.calls["bridge.handshake"]).toHaveLength(1);
    expect(MIN_TAVORA <= LATEST_TAVORA).toBe(true);
  });

  it("refuses a method whose capability was not granted", async () => {
    const { sdk } = createMemoryHost({ capabilities: [] });
    expect(await failure(sdk.network.fetch("https://example.com"))).toMatchObject({ code: "PERMISSION_DENIED", capability: "network" });
  });
});

describe("storage", () => {
  it("sets, reads, lists and deletes, and keeps workspace and app storage apart", async () => {
    const { sdk, host } = createMemoryHost();
    await sdk.storage.set("b", { n: 1 });
    await sdk.storage.set("a", [1, "x"]);
    await sdk.storage.app.set("shared", true);
    expect(await sdk.storage.get("b")).toEqual({ n: 1 });
    expect(await sdk.storage.get("missing")).toBeNull();
    expect(await sdk.storage.keys()).toEqual(["a", "b"]);
    expect(await sdk.storage.app.keys()).toEqual(["shared"]);
    await sdk.storage.delete("a");
    await sdk.storage.delete("never-set");
    expect(host.storage.entries()).toEqual({ b: { n: 1 } });
    expect(host.appStorage.entries()).toEqual({ shared: true });
  });

  it("hands out copies, so changing a read value changes nothing", async () => {
    const { sdk } = createMemoryHost();
    await sdk.storage.set("k", { list: [1] });
    const value = (await sdk.storage.get<{ list: number[] }>("k"))!;
    value.list.push(2);
    expect(await sdk.storage.get("k")).toEqual({ list: [1] });
  });

  it("checks keys, values and the quota like the host", async () => {
    const { sdk } = createMemoryHost({ limits: { maxStoreBytes: 40 } });
    expect(await failure(sdk.storage.set("", 1))).toMatchObject({ code: "INVALID_PARAMS" });
    expect(await failure(sdk.storage.set("k".repeat(LIMITS.maxKeyLength + 1), 1))).toMatchObject({ code: "INVALID_PARAMS" });
    expect(await failure(sdk.storage.set("k", { at: new Date() } as never))).toMatchObject({ code: "INVALID_PARAMS" });
    expect(await failure(sdk.storage.set("k", NaN))).toMatchObject({ code: "INVALID_PARAMS" });
    await sdk.storage.set("k", "x".repeat(30));
    expect(await failure(sdk.storage.set("other", "x".repeat(30)))).toMatchObject({ code: "QUOTA_EXCEEDED" });
    // Replacing a value counts only the difference.
    await sdk.storage.set("k", "y".repeat(34));
  });

  it("compareAndSet sets only while the key holds what was expected, whatever the order of keys", async () => {
    const { sdk } = createMemoryHost();
    expect(await sdk.storage.compareAndSet("run", null, { a: 1, b: 2 })).toBe(true);
    expect(await sdk.storage.compareAndSet("run", null, 1)).toBe(false);
    expect(await sdk.storage.compareAndSet("run", { b: 2, a: 1 }, { a: 3 })).toBe(true);
    expect(await sdk.storage.compareAndSet("run", { a: 1 }, 5)).toBe(false);
    expect(await sdk.storage.get("run")).toEqual({ a: 3 });
    expect(await sdk.storage.app.compareAndSet("run", null, 1)).toBe(true);
    expect(await sdk.storage.get("run")).toEqual({ a: 3 });
  });

  it("compareAndSet throws QUOTA_EXCEEDED rather than answering false when the value is too big", async () => {
    const { sdk } = createMemoryHost({ limits: { maxStoreBytes: 20 } });
    expect(await failure(sdk.storage.compareAndSet("k", null, "x".repeat(30)))).toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});

describe("documents", () => {
  it("numbers revisions from 1, and keeps title, size and time", async () => {
    let clock = Date.parse("2026-10-29T10:00:00.000Z");
    const { sdk } = createMemoryHost({ now: () => clock });
    const first = await sdk.documents.put({ id: "plan", title: "Plan", data: { a: 1 } });
    expect(first).toEqual({ id: "plan", title: "Plan", revision: 1, updatedAt: "2026-10-29T10:00:00.000Z", bytes: 7 });
    clock += 1000;
    const second = await sdk.documents.put({ id: "plan", title: "Plan 2", data: { a: 2 }, ifRevision: 1 });
    expect(second).toMatchObject({ revision: 2, title: "Plan 2", updatedAt: "2026-10-29T10:00:01.000Z" });
    expect(await sdk.documents.get("plan")).toEqual({ ...second, data: { a: 2 } });
    expect(await sdk.documents.get("nope")).toBeNull();
  });

  it("makes an id when none is given, and lists the newest first", async () => {
    const { sdk } = createMemoryHost({ now: () => 0 });
    const a = await sdk.documents.put({ title: "A", data: 1 });
    const b = await sdk.documents.put({ id: "b", title: "B", data: 2 });
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect((await sdk.documents.list()).map((doc) => doc.id)).toEqual(["b", a.id]);
  });

  it("answers CONFLICT with the current revision when ifRevision is stale", async () => {
    const { sdk } = createMemoryHost();
    await sdk.documents.put({ id: "d", title: "D", data: 1 });
    await sdk.documents.put({ id: "d", title: "D", data: 2 });
    const error = await failure(sdk.documents.put({ id: "d", title: "D", data: 3, ifRevision: 1 }));
    expect(error).toBeInstanceOf(TavoraError);
    expect(error).toMatchObject({ code: "CONFLICT", revision: 2, message: "document is at revision 2, not 1" });
    expect((await sdk.documents.get("d"))!.data).toBe(2);
  });

  it("treats ifRevision on a new document as revision 0, and ifRevision 0 as 'must not exist'", async () => {
    const { sdk } = createMemoryHost();
    expect(await failure(sdk.documents.put({ id: "n", title: "N", data: 1, ifRevision: 3 }))).toMatchObject({ code: "CONFLICT", revision: 0 });
    await sdk.documents.put({ id: "n", title: "N", data: 1, ifRevision: 0 });
    expect(await failure(sdk.documents.put({ id: "n", title: "N", data: 1, ifRevision: 0 }))).toMatchObject({ code: "CONFLICT", revision: 1 });
  });

  it("deletes, honouring ifRevision, and ignores a document that is not there", async () => {
    const { sdk } = createMemoryHost();
    await sdk.documents.put({ id: "d", title: "D", data: 1 });
    expect(await failure(sdk.documents.delete("d", { ifRevision: 5 }))).toMatchObject({ code: "CONFLICT", revision: 1 });
    await sdk.documents.delete("d", { ifRevision: 1 });
    await sdk.documents.delete("d", { ifRevision: 99 });
    expect(await sdk.documents.list()).toEqual([]);
  });

  it("checks ids, titles, data and quotas", async () => {
    const { sdk } = createMemoryHost({ limits: { maxDocumentBytes: 20, maxDocuments: 2, maxDocumentsBytes: 30 } });
    expect(await failure(sdk.documents.put({ id: "bad id", title: "T", data: 1 }))).toMatchObject({ code: "INVALID_PARAMS" });
    expect(await failure(sdk.documents.put({ title: "T".repeat(LIMITS.maxTitleLength + 1), data: 1 }))).toMatchObject({ code: "INVALID_PARAMS" });
    expect(await failure(sdk.documents.put({ id: "d", title: "T", data: undefined as never }))).toMatchObject({ code: "INVALID_PARAMS" });
    expect(await failure(sdk.documents.put({ id: "d", title: "T", data: 1, ifRevision: 1.5 }))).toMatchObject({ code: "INVALID_PARAMS" });
    expect(await failure(sdk.documents.put({ id: "d", title: "T", data: "x".repeat(30) }))).toMatchObject({ code: "QUOTA_EXCEEDED" });
    await sdk.documents.put({ id: "a", title: "A", data: "x".repeat(15) });
    expect(await failure(sdk.documents.put({ id: "b", title: "B", data: "x".repeat(15) }))).toMatchObject({ code: "QUOTA_EXCEEDED" });
    await sdk.documents.put({ id: "b", title: "B", data: 1 });
    expect(await failure(sdk.documents.put({ id: "c", title: "C", data: 1 }))).toMatchObject({ code: "QUOTA_EXCEEDED" });
  });

  it("hands out copies of the data", async () => {
    const { sdk } = createMemoryHost();
    const data = { list: [1] };
    await sdk.documents.put({ id: "d", title: "D", data });
    data.list.push(2);
    expect((await sdk.documents.get("d"))!.data).toEqual({ list: [1] });
  });

  it("lets the test seed and read documents through host.documents", async () => {
    const { sdk, host } = createMemoryHost();
    host.documents.put({ id: "seed", title: "Seed", data: { n: 1 } });
    expect(host.documents.get("seed")).toMatchObject({ revision: 1, data: { n: 1 } });
    expect(await sdk.documents.list()).toHaveLength(1);
    host.documents.delete("seed");
    host.documents.clear();
    expect(host.documents.list()).toEqual([]);
  });
});

describe("a second panel sharing the host", () => {
  it("sees the other panel's storage and documents, and hears its changes but not its own", async () => {
    const first = createMemoryHost();
    const second = createMemoryHost({ share: first.host });
    const heardFirst = vi.fn();
    const heardSecond = vi.fn();
    first.sdk.documents.onChange(heardFirst);
    second.sdk.documents.onChange(heardSecond);

    await first.sdk.storage.set("k", 1);
    expect(await second.sdk.storage.get("k")).toBe(1);

    const saved = await first.sdk.documents.put({ id: "d", title: "D", data: 1 });
    await Promise.resolve();
    expect(saved.revision).toBe(1);
    expect(heardSecond).toHaveBeenCalledWith({ id: "d", revision: 1, deleted: false });
    expect(heardFirst).not.toHaveBeenCalled();

    // The other panel saved first: the first one's save with the old revision is a conflict.
    await second.sdk.documents.put({ id: "d", title: "D", data: 2, ifRevision: 1 });
    expect(await failure(first.sdk.documents.put({ id: "d", title: "D", data: 3, ifRevision: 1 }))).toMatchObject({ code: "CONFLICT", revision: 2 });
    await second.sdk.documents.delete("d");
    await Promise.resolve();
    expect(heardFirst.mock.calls).toEqual([[{ id: "d", revision: 2, deleted: false }], [{ id: "d", revision: 2, deleted: true }]]);
  });

  it("keeps panel state, content and recorded calls per panel, and broadcasts theme and language", async () => {
    const first = createMemoryHost({ panelType: "main" });
    const second = createMemoryHost({ share: first.host, panelType: "side" });
    await first.sdk.panel.setState({ tab: 1 });
    expect(await second.sdk.panel.getState()).toBeNull();
    expect(second.host.calls["panel.setState"]).toBeUndefined();
    const themes = vi.fn();
    const languages = vi.fn();
    second.sdk.ui.onThemeChange(themes);
    second.sdk.ui.onLanguageChange(languages);
    first.host.changeTheme({ mode: "light" });
    first.host.setLanguage("de");
    expect(themes).toHaveBeenCalledWith(expect.objectContaining({ mode: "light" }));
    expect(languages).toHaveBeenCalledWith("de");
    expect(await second.sdk.ui.getLanguage()).toBe("de");
  });

  it("stops telling a panel that was disposed", async () => {
    const first = createMemoryHost();
    const second = createMemoryHost({ share: first.host });
    const heard = vi.fn();
    second.sdk.documents.onChange(heard);
    second.host.dispose();
    await first.sdk.documents.put({ id: "d", title: "D", data: 1 });
    await Promise.resolve();
    expect(heard).not.toHaveBeenCalled();
  });

  it("rejects something that is not a memory host", () => {
    expect(() => createMemoryHost({ share: {} as never })).toThrow(TypeError);
  });
});

describe("panel", () => {
  it("keeps state, clears it with null, and refuses too much", async () => {
    const { sdk, host } = createMemoryHost({ limits: { maxPanelStateBytes: 20 } });
    await sdk.panel.setState({ a: 1 });
    expect(await sdk.panel.getState()).toEqual({ a: 1 });
    expect(host.state).toEqual({ a: 1 });
    expect(await failure(sdk.panel.setState("x".repeat(30)))).toMatchObject({ code: "QUOTA_EXCEEDED" });
    await sdk.panel.setState(null);
    expect(await sdk.panel.getState()).toBeNull();
  });

  it("tells why the page loaded, and keeps the content it shows", async () => {
    const { sdk, host } = createMemoryHost({ launch: { reason: "restore", content: { id: "b1", title: "Build 1" } } });
    expect(await sdk.panel.getLaunch()).toEqual({ reason: "restore", content: { id: "b1", title: "Build 1" } });
    await sdk.panel.setContent({ id: "b2", title: "Build 2" });
    expect(host.content).toEqual({ id: "b2", title: "Build 2" });
    expect(await failure(sdk.panel.setContent({ id: "", title: "x" }))).toMatchObject({ code: "INVALID_PARAMS" });
    await sdk.panel.setContent(null);
    expect(host.content).toBeNull();
  });

  it("runs the navigate handler for host.navigate and says how it went", async () => {
    const { sdk, host } = createMemoryHost();
    expect(await host.navigate({ id: "x", title: "X" })).toEqual({ handled: false, ok: false });
    const seen: string[] = [];
    const off = sdk.panel.onNavigate((content) => void seen.push(content.id));
    expect(await host.navigate({ id: "a", title: "A" })).toEqual({ handled: true, ok: true });
    sdk.panel.onNavigate(() => {
      throw new Error("cannot");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await host.navigate({ id: "b", title: "B" })).toEqual({ handled: true, ok: false });
    off();
    expect(seen).toEqual(["a"]);
    expect(host.calls["panel.navigated"]).toEqual([
      { requestId: 1, handled: false, ok: false },
      { requestId: 2, handled: true, ok: true },
      { requestId: 3, handled: true, ok: false },
    ]);
  });

  it("maximizes and opens a dialog, and tells listeners when it changes whoever did it", async () => {
    const { sdk, host } = createMemoryHost();
    const maximized = vi.fn();
    const dialog = vi.fn();
    sdk.panel.onMaximizedChange(maximized);
    sdk.panel.onDialogChange(dialog);
    await sdk.panel.setMaximized(true);
    await sdk.panel.setMaximized(true);
    expect(await sdk.panel.isMaximized()).toBe(true);
    host.setMaximized(false);
    expect(maximized.mock.calls).toEqual([[true], [false]]);
    await sdk.panel.openDialog({ width: 300 });
    expect(host.dialog).toEqual({ open: true, width: 300, height: 640 });
    host.setDialog(false);
    await sdk.panel.closeDialog();
    expect(dialog.mock.calls).toEqual([[true], [false]]);
    expect(await failure(sdk.panel.openDialog({ width: 10 }))).toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("keeps the live state", async () => {
    const { sdk, host } = createMemoryHost({ limits: { maxOverlayStateBytes: 10 } });
    await sdk.panel.setLive({ a: 1 });
    expect(host.live).toEqual({ a: 1 });
    expect(await failure(sdk.panel.setLive("x".repeat(20)))).toMatchObject({ code: "QUOTA_EXCEEDED" });
    await sdk.panel.setLive(null);
    expect(host.live).toBeNull();
  });

  it("panels.open shows, switches or opens, like the host", async () => {
    const main = createMemoryHost({ panelType: "main", panelTypes: ["main", "side"] });
    const content = { id: "b1", title: "Build 1" };
    expect(await main.sdk.panels.open("side", { content })).toBe("opened");
    expect(main.host.opened).toEqual([{ type: "side", content }]);
    expect(await failure(main.sdk.panels.open("other"))).toMatchObject({ code: "INVALID_PARAMS" });

    const side = createMemoryHost({ share: main.host, panelType: "side" });
    expect(await main.sdk.panels.open("side", { content })).toBe("opened");
    side.sdk.panel.onNavigate(async () => {});
    await side.sdk.panel.setContent({ id: "b0", title: "Build 0" });
    expect(await main.sdk.panels.open("side", { content })).toBe("switched");
    await side.sdk.panel.setContent(content);
    expect(await main.sdk.panels.open("side", { content })).toBe("shown");
    side.sdk.panel.onNavigate(() => {
      throw new Error("no");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main.sdk.panels.open("side", { content: { id: "b9", title: "B9" } })).toBe("failed");
  });

  it("panels.openMany opens each type once, shows the ones open already, and refuses a bad list", async () => {
    const main = createMemoryHost({ panelType: "main", panelTypes: ["main", "map", "bosses"], gestures: "enforce" });
    expect(main.sdk.supports("panels.openMany")).toBe(true);
    expect(await failure(main.sdk.panels.openMany(["map"]))).toMatchObject({ code: "PERMISSION_DENIED" });
    // One press covers the whole call.
    main.host.gesture();
    expect(await main.sdk.panels.openMany(["main", "map", "bosses"])).toEqual({ main: "shown", map: "opened", bosses: "opened" });
    expect(main.host.opened).toEqual([
      { type: "map", content: null },
      { type: "bosses", content: null },
    ]);
    main.host.gesture();
    expect(await main.sdk.panels.openMany(["map"])).toEqual({ map: "shown" });
    for (const types of [[], ["map", "map"], ["other"]]) {
      main.host.gesture();
      expect(await failure(main.sdk.panels.openMany(types))).toMatchObject({ code: "INVALID_PARAMS" });
    }
    expect(createMemoryHost({ version: "0.23.28" }).sdk.supports("panels.openMany")).toBe(false);
  });
});

describe("workspace and ui", () => {
  it("answers the workspace, the viewport, the theme and the language, and tells about changes", async () => {
    const { sdk, host } = createMemoryHost({ workspace: { id: "poe2", displayName: "Path of Exile 2", kind: "game" }, language: "de", viewport: { width: 1, height: 2 } });
    expect(await sdk.workspace.getCurrent()).toEqual({ id: "poe2", displayName: "Path of Exile 2", kind: "game" });
    expect(await sdk.game.getCurrent()).toEqual({ id: "poe2", displayName: "Path of Exile 2", kind: "game" });
    expect(await sdk.workspace.getViewport()).toEqual({ width: 1, height: 2 });
    expect(await sdk.ui.getLanguage()).toBe("de");
    expect((await sdk.ui.getTheme()).mode).toBe("dark");

    const sizes = vi.fn();
    const themes = vi.fn();
    const languages = vi.fn();
    const off = sdk.workspace.onResize(sizes);
    sdk.ui.onThemeChange(themes);
    sdk.ui.onLanguageChange(languages);
    host.resize({ width: 10, height: 20 });
    host.changeTheme({ mode: "light", radius: 2 });
    host.setLanguage("en");
    off();
    host.resize({ width: 30, height: 40 });
    expect(sizes.mock.calls).toEqual([[{ width: 10, height: 20 }]]);
    expect(themes.mock.calls[0]![0]).toMatchObject({ mode: "light", radius: 2 });
    expect(languages.mock.calls).toEqual([["en"]]);
    expect(await sdk.ui.getLanguage()).toBe("en");
    expect(await sdk.workspace.getViewport()).toEqual({ width: 30, height: 40 });
  });

  it("answers game.getCurrent in the old words for a personal workspace", async () => {
    const { sdk } = createMemoryHost();
    expect(await sdk.game.getCurrent()).toMatchObject({ kind: "workspace" });
  });

  describe("anchors", () => {
    const element = (box: { x: number; y: number; width: number; height: number }) =>
      ({ getBoundingClientRect: () => ({ ...box, left: box.x, top: box.y }) }) as unknown as Element;

    it("sends an element's box as the menu's `at`, read when called", async () => {
      const { sdk, host } = createMemoryHost();
      const box = { x: 10, y: 20, width: 30, height: 40 };
      let current = box;
      const el = { getBoundingClientRect: () => current } as unknown as Element;
      current = { x: 1, y: 2, width: 3, height: 4 };
      await sdk.ui.showMenu({ anchor: el, items: [], align: "end" });
      expect(host.calls["ui.showMenu"]).toEqual([{ items: [], align: "end", at: { x: 1, y: 2, width: 3, height: 4 } }]);
    });

    it("passes a box anchor and a bare `at` through", async () => {
      const { sdk, host } = createMemoryHost();
      await sdk.ui.showMenu({ anchor: { x: 5, y: 6, width: 7, height: 8 }, items: [] });
      await sdk.ui.showMenu({ at: { x: 1, y: 2 }, items: [] });
      expect(host.calls["ui.showMenu"]).toEqual([
        { items: [], at: { x: 5, y: 6, width: 7, height: 8 } },
        { items: [], at: { x: 1, y: 2 } },
      ]);
    });

    it("rejects a menu with neither anchor nor at", async () => {
      const { sdk, host } = createMemoryHost();
      expect(await failure(sdk.ui.showMenu({ items: [] } as never))).toMatchObject({ code: "INVALID_PARAMS" });
      expect(host.calls["ui.showMenu"] ?? []).toEqual([]);
    });

    it("puts a tooltip next to its element: the middle of the right edge", async () => {
      const { sdk, host } = createMemoryHost();
      await sdk.ui.tooltip.move({ id: "t", anchor: element({ x: 10, y: 20, width: 30, height: 40 }) });
      await sdk.ui.tooltip.move({ id: "t", at: { x: 1, y: 2 } });
      await sdk.ui.tooltip.show({ id: "t", anchor: { x: 0, y: 0, width: 10, height: 10 }, content: { title: "T" } });
      expect(host.calls["ui.tooltip.move"]).toEqual([{ id: "t", at: { x: 40, y: 40 } }, { id: "t", at: { x: 1, y: 2 } }]);
      expect(host.calls["ui.tooltip.show"]).toEqual([{ id: "t", content: { title: "T" }, at: { x: 10, y: 5 } }]);
      expect(await failure(sdk.ui.tooltip.move({ id: "t" } as never))).toMatchObject({ code: "INVALID_PARAMS" });
    });
  });

  it("records menus and tooltips and answers them as scripted", async () => {
    const { sdk, host } = createMemoryHost();
    const request = { items: [{ id: "a", label: "A" }], at: { x: 1, y: 2, width: 3, height: 4 } } as never;
    expect(await sdk.ui.showMenu(request)).toBeNull();
    host.answer("ui.showMenu", () => "a");
    expect(await sdk.ui.showMenu(request)).toBe("a");
    expect(host.calls["ui.showMenu"]).toEqual([request, request]);
    expect(await sdk.ui.tooltip.show({ id: "t", at: { x: 0, y: 0 }, content: { title: "T" } })).toBe(true);
    await sdk.ui.tooltip.hide("t");
    host.emit("ui.tooltipClosed", { id: "t" });
    expect(host.calls["ui.tooltip.hide"]).toEqual([{ id: "t" }]);
  });
});

describe("scripted answers", () => {
  it("answers with what the test says, records the call, and can be taken away", async () => {
    const { sdk, host } = createMemoryHost();
    host.answer("network.fetch", ({ url }) => ({ status: 200, url, headers: {}, body: "hi" }));
    expect(await sdk.network.fetch("https://example.com/a")).toMatchObject({ status: 200, body: "hi" });
    expect(host.calls["network.fetch"]).toEqual([{ url: "https://example.com/a" }]);
    host.answer("network.fetch", () => {
      throw new TavoraError({ code: "NETWORK_ERROR", message: "down" });
    });
    expect(await failure(sdk.network.fetch("https://example.com/a"))).toMatchObject({ code: "NETWORK_ERROR" });
    host.unanswer("network.fetch");
    expect(await failure(sdk.network.fetch("https://example.com/a"))).toMatchObject({ code: "INTERNAL", message: expect.stringContaining("host.answer") });
    expect(host.log.map((call) => call.method)).toEqual(["bridge.handshake", "network.fetch", "network.fetch", "network.fetch"]);
  });

  it("can replace a call the memory host implements, and a scripted answer may be async", async () => {
    const { sdk, host } = createMemoryHost();
    host.answer("storage.get", async () => "scripted");
    expect(await sdk.storage.get("anything")).toBe("scripted");
  });

  it("answers the file, picture and blob calls like the host does, and records what was saved", async () => {
    const { sdk, host } = createMemoryHost();
    expect(await sdk.files.saveJson({ a: 1 }, "Build")).toEqual({ fileName: "Build.json" });
    expect(await sdk.files.openJson()).toBeNull();
    host.answer("files.openJson", () => ({ fileName: "a.json", value: { x: 1 } }));
    expect(await sdk.files.openJson()).toEqual({ fileName: "a.json", value: { x: 1 } });
    expect(await sdk.pictures.save(new Blob(["x"], { type: "image/png" }), "Shot")).toEqual({ fileName: "Shot.png" });
    expect(host.saved.map((item) => [item.kind, item.fileName])).toEqual([["json", "Build.json"], ["picture", "Shot.png"]]);
    expect(await failure(sdk.pictures.save(new Blob(["x"], { type: "text/plain" })))).toMatchObject({ code: "INVALID_PARAMS" });
    expect(await failure(sdk.files.saveJson(undefined as never))).toMatchObject({ code: "INVALID_PARAMS" });

    const info = await sdk.blobs.put(new Blob(["abc"], { type: "image/webp" }));
    expect(info).toMatchObject({ bytes: 3, type: "image/webp" });
    expect(info.id).toMatch(/^[a-f0-9]{32}$/);
    expect(sdk.blobs.url(info.id)).toContain(info.id);
    expect(await sdk.blobs.usage()).toMatchObject({ bytes: 3, count: 1 });
    expect(await failure(sdk.blobs.put(new Blob(["abc"], { type: "text/plain" })))).toMatchObject({ code: "INVALID_PARAMS" });
    const pdf = await sdk.blobs.put(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    expect(pdf.type).toBe("application/pdf");
    await sdk.blobs.delete(pdf.id);
    await sdk.blobs.delete(info.id);
    expect(await sdk.blobs.list()).toEqual([]);
  });

  it("keeps overlays and hotkeys in memory", async () => {
    const { sdk, host } = createMemoryHost();
    await sdk.overlay.publish("score", { n: 1 });
    expect(host.overlays).toEqual({ score: { n: 1 } });
    await sdk.overlay.remove("score");
    expect(host.overlays).toEqual({});
    expect(await sdk.overlay.showOverGame("score")).toBe("shown");
    expect(await sdk.overlay.overGame()).toEqual(["score"]);
    await sdk.hotkeys.set("undo", "board", "Undo");
    expect(await sdk.hotkeys.list()).toHaveLength(1);
    await sdk.hotkeys.remove("board");
    expect(await sdk.hotkeys.list()).toEqual([]);
  });
});

describe("leaderboards", () => {
  it("follows the user's status, and refuses results until they are shown", async () => {
    const { sdk, host } = createMemoryHost();
    expect(await sdk.leaderboards.status()).toMatchObject({ online: true, signedIn: true, shown: false, name: null });
    expect(await failure(sdk.leaderboards.submit("daily", [{ id: "a", outcome: "won", at: 1, day: "2026-10-28" }]))).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await sdk.leaderboards.show()).toMatchObject({ shown: true, name: "Player" });
    const noon = new Date(2026, 9, 28, 12).getTime();
    expect(await sdk.leaderboards.submit("daily", [{ id: "a", outcome: "won", at: noon }])).toEqual({ accepted: ["a"], rejected: [] });
    expect(host.calls["leaderboards.submit"]).toEqual([
      { board: "daily", results: [{ id: "a", outcome: "won", at: 1, day: "2026-10-28" }] },
      { board: "daily", results: [{ id: "a", outcome: "won", at: noon, day: "2026-10-28" }] },
    ]);
    host.leaderboards.setStatus({ online: false });
    expect(await failure(sdk.leaderboards.submit("daily", []))).toMatchObject({ code: "NETWORK_ERROR" });
    expect(await sdk.leaderboards.hide()).toMatchObject({ shown: false });
  });

  it("takes scripted answers for top, mine and submit", async () => {
    const { sdk, host } = createMemoryHost();
    expect(await sdk.leaderboards.top("daily")).toEqual({ rows: [] });
    host.answer("leaderboards.top", () => ({ rows: [{ name: "Ann", self: true, rank: 1, value: 5 } as never] }));
    expect((await sdk.leaderboards.top("daily", { period: "week", limit: 3 })).rows).toHaveLength(1);
    expect(host.calls["leaderboards.top"]![1]).toEqual({ board: "daily", period: "week", limit: 3 });
    expect(await sdk.leaderboards.mine({ day: "2026-10-28" })).toEqual({ boards: [] });
    host.answer("leaderboards.submit", ({ results }) => ({ accepted: [], rejected: results.map((r) => ({ id: r.id, reason: "duplicate" as never })) }));
    expect((await sdk.leaderboards.submit("daily", [{ id: "z", outcome: "lost", at: 1 }])).rejected).toHaveLength(1);
  });
});

describe("events", () => {
  it("raises any event in the panel, and listeners can stop listening", async () => {
    const { sdk, host } = createMemoryHost();
    const changes: unknown[] = [];
    const off = sdk.documents.onChange((change) => changes.push(change));
    host.emit("documents.changed", { id: "a", revision: 2, deleted: false });
    off();
    host.emit("documents.changed", { id: "a", revision: 3, deleted: false });
    expect(changes).toEqual([{ id: "a", revision: 2, deleted: false }]);
  });

  it("keeps other listeners running when one throws", () => {
    const { sdk, host } = createMemoryHost();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    sdk.lifecycle.onResume(() => {
      throw new Error("boom");
    });
    sdk.lifecycle.onResume(second);
    host.resume();
    expect(second).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it("tells a late onSuspend listener about a current suspension, and onDispose about the end", () => {
    const { sdk, host } = createMemoryHost();
    host.suspend();
    const suspended = vi.fn();
    sdk.lifecycle.onSuspend(suspended);
    expect(suspended).toHaveBeenCalledOnce();
    host.resume();
    const late = vi.fn();
    sdk.lifecycle.onSuspend(late);
    expect(late).not.toHaveBeenCalled();
    const disposed = vi.fn();
    sdk.lifecycle.onDispose(disposed);
    host.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it("passes on hotkey presses and account changes raised by the test", () => {
    const { sdk, host } = createMemoryHost();
    const pressed = vi.fn();
    const accounts = vi.fn();
    sdk.hotkeys.onPress(pressed);
    sdk.connectors.aiUsage.onAccountsChange(accounts);
    host.emit("hotkeys.pressed", { action: "undo", target: "board" });
    host.emit("aiUsage.accountsChanged", null);
    expect(pressed).toHaveBeenCalledWith({ action: "undo", target: "board" });
    expect(accounts).toHaveBeenCalledOnce();
  });
});

describe("gestures", () => {
  it("lets everything through by default", async () => {
    const { sdk } = createMemoryHost();
    await sdk.links.open("https://example.com");
    await sdk.panel.setMaximized(true);
  });

  it("refuses gated calls without a click when enforced, and lets one through per click", async () => {
    const { sdk, host } = createMemoryHost({ gestures: "enforce" });
    expect(await failure(sdk.links.open("https://example.com"))).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await failure(sdk.panel.setMaximized(true))).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await failure(sdk.files.saveJson({}))).toMatchObject({ code: "PERMISSION_DENIED" });
    await host.click(() => sdk.links.open("https://example.com"));
    expect(await failure(sdk.links.open("https://example.com"))).toMatchObject({ code: "PERMISSION_DENIED" });
    host.gesture(2);
    await sdk.panel.setMaximized(true);
    await sdk.ui.showMenu({ items: [], at: { x: 0, y: 0 } });
    expect(await failure(sdk.ui.showMenu({ items: [], at: { x: 0, y: 0 } }))).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("does not ask for a click where the host does not", async () => {
    const { sdk } = createMemoryHost({ gestures: "enforce" });
    await sdk.panel.setMaximized(false);
    await sdk.panel.closeDialog();
    await sdk.ui.tooltip.show({ id: "t", at: { x: 0, y: 0 }, content: { title: "T" } });
    expect(await failure(sdk.ui.tooltip.show({ id: "t", at: { x: 0, y: 0 }, content: { title: "T" }, pinned: true }))).toMatchObject({ code: "PERMISSION_DENIED" });
    await sdk.storage.set("k", 1);
  });
});

describe("an older Tavora", () => {
  it("throws UNKNOWN_METHOD for methods the version did not have yet", async () => {
    const { sdk, host } = createMemoryHost({ version: "0.21.50" });
    expect(sdk.host.host.version).toBe("0.21.50");
    expect(await failure(sdk.storage.compareAndSet("k", null, 1))).toMatchObject({ code: "UNKNOWN_METHOD" });
    expect(await failure(sdk.panel.openDialog())).toMatchObject({ code: "UNKNOWN_METHOD" });
    expect(await failure(sdk.leaderboards.status())).toMatchObject({ code: "UNKNOWN_METHOD" });
    await sdk.storage.set("k", 1);
    expect(host.calls["storage.compareAndSet"]).toHaveLength(1);
  });

  it("asks workspace.getCurrent by the old name, in the new words", async () => {
    const { sdk, host } = createMemoryHost({ version: "0.21.0", workspace: { id: "notes", displayName: "Notes", kind: "personal" } });
    expect(await sdk.workspace.getCurrent()).toEqual({ id: "notes", displayName: "Notes", kind: "personal" });
    host.setWorkspace({ id: "poe2", displayName: "Path of Exile 2", kind: "game" });
    expect(await sdk.workspace.getCurrent()).toEqual({ id: "poe2", displayName: "Path of Exile 2", kind: "game" });
    expect(host.calls["game.getCurrent"]).toHaveLength(2);
  });

  it("knows every version up to the newest", async () => {
    const { sdk } = createMemoryHost({ version: LATEST_TAVORA });
    expect(await sdk.storage.compareAndSet("k", null, 1)).toBe(true);
    expect(await sdk.leaderboards.mine()).toEqual({ boards: [] });
  });
});
