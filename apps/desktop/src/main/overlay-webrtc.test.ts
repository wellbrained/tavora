import { beforeEach, describe, expect, it, vi } from "vitest";

// Every view that runs an overlay page (a game overlay, a live view, an Overlay page canvas item, a preview) and Tavora's
// own pages around one keep WebRTC to the (dead) proxy, as module panels do: webRequest and the CSP don't see WebRTC UDP,
// so without it a module with no network grant could send its overlay state out (G4).

type Contents = { url: string | null; policy: string | null; openDenied: boolean; navigationBlocked: boolean };
const world = vi.hoisted(() => ({ contents: [] as Contents[] }));

vi.mock("electron", () => {
  const ses = {
    protocol: { isProtocolHandled: () => false, unhandle: () => undefined, handle: () => undefined },
    webRequest: { onBeforeRequest: () => undefined },
    setProxy: async () => undefined,
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setDevicePermissionHandler: () => undefined,
    setSpellCheckerEnabled: () => undefined,
    on: () => undefined,
  };
  const contents = () => {
    const seen: Contents = { url: null, policy: null, openDenied: false, navigationBlocked: false };
    world.contents.push(seen);
    return {
      id: world.contents.length,
      setWindowOpenHandler: (fn: () => { action: string }) => void (seen.openDenied = fn().action === "deny"),
      setWebRTCIPHandlingPolicy: (policy: string) => void (seen.policy = policy),
      on: (name: string, fn: (event: { preventDefault(): void }) => void) => {
        if (name !== "will-navigate") return;
        let prevented = false;
        fn({ preventDefault: () => void (prevented = true) });
        seen.navigationBlocked = prevented;
      },
      once: () => undefined,
      loadURL: async (url: string) => void (seen.url = url),
      isDestroyed: () => false,
      close: () => undefined,
      send: () => undefined,
      focus: () => undefined,
      getZoomFactor: () => 1,
      setZoomFactor: () => undefined,
      insertCSS: async () => "css",
      removeInsertedCSS: async () => undefined,
      ipc: { on: () => undefined },
    };
  };
  class View {
    webContents = contents();
    setBackgroundColor() {}
    setVisible() {}
    setBounds() {}
  }
  class BrowserWindow {
    webContents = contents();
    contentView = { addChildView: () => undefined, removeChildView: () => undefined };
    on() {}
    once() {}
    removeMenu() {}
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    setOpacity() {}
    isDestroyed() {
      return false;
    }
    getContentBounds() {
      return { x: 0, y: 0, width: 400, height: 300 };
    }
    show() {}
  }
  return {
    BrowserWindow,
    WebContentsView: View,
    app: { on: () => undefined, removeListener: () => undefined },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    session: { fromPartition: () => ses },
  };
});

const { GameOverlayWindow } = await import("./game-overlay-window");
const { OverlayPreviewWindow } = await import("./overlay-preview-window");
const { OverlayCanvas } = await import("./overlay-canvas");
const { BrowserWindow } = await import("electron");

const source = { page: () => null, state: () => null, watch: () => () => undefined } as never;

function overlayWindow(panel?: unknown) {
  return new GameOverlayWindow({
    preload: "x",
    hidden: true,
    source,
    id: "overlay",
    gameBounds: () => null,
    moved: () => undefined,
    closeRequested: () => undefined,
    layoutRequested: () => undefined,
    ended: () => undefined,
    frameText: () => ({ name: "Clock", closeLabel: "Close", layoutLabel: "Layout" }),
    ...(panel ? { panel: panel as never } : {}),
  });
}

function expectLocked(made: Contents[]) {
  expect(made.length).toBeGreaterThan(0);
  for (const contents of made) {
    expect(contents.policy, `WebRTC policy of ${contents.url ?? "a page"}`).toBe("disable_non_proxied_udp");
    expect(contents.openDenied).toBe(true);
    expect(contents.navigationBlocked).toBe(true);
  }
}

beforeEach(() => {
  world.contents.length = 0;
});

describe("WebRTC on overlay pages (G4)", () => {
  it("a game overlay's page and its arrange frame keep WebRTC to the proxy", () => {
    overlayWindow();
    expect(world.contents.some((contents) => contents.url?.startsWith("tavora-overlay://"))).toBe(true);
    expectLocked(world.contents);
  });

  it("a window holding a panel (a live view) locks its own pages too", () => {
    const panel = {
      view: { webContents: { focus: () => undefined } },
      enterGame: () => undefined,
      leaveGame: () => undefined,
      setBounds: () => undefined,
      setVisible: () => undefined,
      setGameOpacity: () => undefined,
      setGameZoom: () => undefined,
      suspend: () => undefined,
      resume: () => undefined,
    };
    overlayWindow(panel);
    expectLocked(world.contents);
  });

  it("a preview's page, its footer and its window keep WebRTC to the proxy", () => {
    new OverlayPreviewWindow(
      { id: "preview", title: "Clock", source, closed: () => undefined },
      { hidden: true, labels: { dark: "Dark", light: "Light", checker: "Checkered" } },
    );
    expect(world.contents.some((contents) => contents.url?.startsWith("tavora-overlay://"))).toBe(true);
    expectLocked(world.contents);
  });

  it("every overlay page on the Overlay page's canvas keeps WebRTC to the proxy", () => {
    const window = new BrowserWindow() as never;
    const canvas = new OverlayCanvas({ window, preload: "x", devTools: false, address: () => "http://layer" });
    world.contents.length = 0;
    const frame = (id: string) => ({ id, source, bounds: { x: 0, y: 0, width: 100, height: 50 }, zoom: 1, opacity: 1, visible: true });
    canvas.place([frame("a"), frame("b")], { x: 0, y: 0, width: 400, height: 300 }, false);
    expect(world.contents.filter((contents) => contents.url?.startsWith("tavora-overlay://"))).toHaveLength(2);
    expectLocked(world.contents);
  });
});
