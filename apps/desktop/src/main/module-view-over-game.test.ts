import { describe, expect, it, vi } from "vitest";

// ModuleView needs only a little of Electron to be made: a view with a page, and a session to harden.
const made = vi.hoisted(() => ({ views: [] as { background: string; visible: boolean; css: string[]; removed: string[] }[] }));

vi.mock("electron", () => {
  const session = () => ({
    protocol: { handle: () => undefined },
    webRequest: { onBeforeRequest: () => undefined },
    setProxy: async () => undefined,
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setDevicePermissionHandler: () => undefined,
    setSpellCheckerEnabled: () => undefined,
    on: () => undefined,
  });
  const ses = session();
  class WebContentsView {
    state = { background: "", visible: true, css: [] as string[], removed: [] as string[] };
    webContents = {
      session: ses,
      setWindowOpenHandler: () => undefined,
      setWebRTCIPHandlingPolicy: () => undefined,
      on: () => undefined,
      loadURL: async () => undefined,
      isDestroyed: () => false,
      insertCSS: async (css: string) => (this.state.css.push(css), `key-${this.state.css.length}`),
      removeInsertedCSS: async (key: string) => void this.state.removed.push(key),
      send: () => undefined,
      postMessage: () => undefined,
    };
    constructor() {
      made.views.push(this.state);
    }
    setBackgroundColor(color: string) {
      this.state.background = color;
    }
    setBorderRadius() {}
    setVisible(visible: boolean) {
      this.state.visible = visible;
    }
    setBounds() {}
  }
  return {
    app: { isPackaged: false, getPath: () => "/nowhere" },
    clipboard: {},
    ClipboardItem: class {},
    MessageChannelMain: class {},
    session: { fromPartition: () => ses },
    WebContentsView,
  };
});

const { ModuleView } = await import("./module-view");

function make() {
  const options = {
    instanceId: "11111111-1111-4111-8111-111111111111",
    module: { owner: "official", root: "/nowhere", provenance: "official", manifest: { id: "tavora.todos", entry: "dist/index.html", permissions: {} } },
    panelType: null,
    game: { id: "elden", displayName: "Elden Ring", kind: "game" },
    data: { blobs: {} },
    getTheme: () => ({ tokens: { background: "#202020" } }),
    savePicture: async () => null,
    saveJson: async () => null,
    openJson: async () => null,
    discord: { release: () => undefined },
  };
  return new ModuleView(options as never);
}

describe("a panel over the game", () => {
  it("counts a click or key press only while arranging, and always in the workspace", () => {
    const view = make();
    const taken = () => {
      view.usedAt = 0;
      view.noteGesture();
      return view.usedAt > 0;
    };
    expect(taken()).toBe(true);

    let arranging = false;
    view.enterGame(() => arranging);
    expect(view.isOverGame).toBe(true);
    expect(taken()).toBe(false);
    arranging = true;
    expect(taken()).toBe(true);
    arranging = false;
    expect(taken()).toBe(false);

    view.leaveGame();
    expect(view.isOverGame).toBe(false);
    expect(taken()).toBe(true);
  });

  it("drops its colour over the game so the opacity shows through, and gets it back", () => {
    const view = make();
    const state = made.views.at(-1)!;
    expect(state.background).toBe("#202020");
    view.enterGame(() => false);
    expect(state.background).toBe("#00000000");
    // A new theme while over the game doesn't paint the panel opaque again.
    view.applyTheme({ tokens: { background: "#ffffff" } } as never);
    expect(state.background).toBe("#00000000");
    view.leaveGame();
    expect(state.background).toBe("#202020");
  });

  it("fades the page by a style of Tavora's own, and takes it away when it comes back", async () => {
    const view = make();
    const state = made.views.at(-1)!;
    view.enterGame(() => false);
    view.setGameOpacity(50);
    await vi.waitFor(() => expect(state.css.some((css) => css.includes("opacity:0.5"))).toBe(true));
    view.setGameOpacity(100);
    await vi.waitFor(() => expect(state.removed).toHaveLength(1));
    view.setGameOpacity(25);
    await vi.waitFor(() => expect(state.css.some((css) => css.includes("opacity:0.25"))).toBe(true));
    view.leaveGame();
    await vi.waitFor(() => expect(state.removed).toHaveLength(2));
  });
});
