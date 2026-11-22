// Too many tabs (Settings > Appearance) reaches the modules with the theme: picking it sends `ui.theme` to every open
// module panel, so the kit's TabStrip follows it at once, as the dock's own tabs do.
import { describe, expect, it, vi } from "vitest";
import type { TavoraTheme } from "@tavora/sdk/protocol";

vi.mock("electron", () => {
  // Host's module graph reads Electron's API at load; nothing here runs it.
  const stub: object = new Proxy(function () {}, { get: (_target, key) => (key === "then" ? undefined : stub), apply: () => stub, construct: () => stub });
  return { default: stub, app: stub, BrowserWindow: stub, ipcMain: stub, nativeTheme: stub, screen: stub, session: stub, shell: stub, dialog: stub, Menu: stub, protocol: stub, net: stub, WebContentsView: stub, globalShortcut: stub, powerMonitor: stub, clipboard: stub, nativeImage: stub, webContents: stub, safeStorage: stub, systemPreferences: stub, Notification: stub, Tray: stub, MessageChannelMain: stub, utilityProcess: stub, desktopCapturer: stub };
});

const { Host } = await import("./host");
const { ModuleView } = await import("./module-view");
const { THEME } = await import("./games");
const { FALLBACK_STYLE } = await import("./styles");

/** A module panel whose bridge records what it hears. */
function modulePanel() {
  const emit = vi.fn<(event: string, data: unknown) => void>();
  const view = Object.create(ModuleView.prototype) as InstanceType<typeof ModuleView>;
  Object.assign(view, { overGame: false, frameWaiters: new Set(), view: { setBackgroundColor: () => {} }, themeCss: { replace: async () => {} }, fontCss: { replace: async () => {} }, options: { fontCss: () => "" }, bridge: { emit } });
  return { view, emit };
}

/** A Host with only what changing an appearance setting touches. */
function host(panels: InstanceType<typeof ModuleView>[]) {
  const variation = { id: "dark", name: "Dark", mode: "dark" as const, contrast: "normal" as const, radius: 6, colors: { ...THEME.tokens } };
  const theme = { id: "community.test", name: "Test", description: null, author: null, version: "1.0.0", minTavora: null, variations: [variation] };
  const subject = Object.create(Host.prototype) as Record<string, unknown>;
  Object.assign(subject, {
    library: { tabOverflow: "list", toasts: "bottom-center", radius: null },
    currentTheme: undefined,
    panelTheme: undefined,
    currentChoice: () => ({ theme, variation }),
    currentStyle: () => FALLBACK_STYLE,
    syncNativeTheme: () => {},
    applyTitleBarOverlay: () => {},
    applyCorners: () => {},
    saveLibrary: vi.fn(),
    window: { setBackgroundColor: () => {} },
    toastView: { refresh: () => {} },
    panels: { forgetStandIns: () => {} },
    nativePanels: () => panels,
  });
  const handlers = (subject.actionHandlers as () => Record<string, (action: unknown) => Promise<void>>).call(subject);
  return { subject, handlers };
}

describe("set-tab-overflow", () => {
  it("saves the choice and sends the theme with it to every open module panel", async () => {
    const one = modulePanel();
    const two = modulePanel();
    const { subject, handlers } = host([one.view, two.view]);
    await handlers["set-tab-overflow"]!({ type: "set-tab-overflow", mode: "arrows" });
    expect((subject.library as { tabOverflow: string }).tabOverflow).toBe("arrows");
    expect(subject.saveLibrary).toHaveBeenCalled();
    for (const panel of [one, two]) {
      const sent = panel.emit.mock.calls.filter(([event]) => event === "ui.theme").map(([, data]) => data as TavoraTheme);
      expect(sent.map((theme) => theme.tabOverflow)).toEqual(["arrows"]);
    }

    // Back to the list: the panels hear that too; the same choice again sends nothing new.
    await handlers["set-tab-overflow"]!({ type: "set-tab-overflow", mode: "list" });
    await handlers["set-tab-overflow"]!({ type: "set-tab-overflow", mode: "list" });
    expect(one.emit.mock.calls.filter(([event]) => event === "ui.theme").map(([, data]) => (data as TavoraTheme).tabOverflow)).toEqual(["arrows", "list"]);
  });
});
