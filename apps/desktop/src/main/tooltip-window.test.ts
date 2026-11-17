import { describe, expect, it, vi } from "vitest";
import { MODULE_CSP } from "./assets";
import { TOOLTIP_DOCUMENT } from "../shared/tooltip-document";

// The tooltip page is Tavora's own, but it shows text from modules: it stays sandboxed, in a session of its own, with nothing to ask for.
const made = vi.hoisted(() => ({
  options: [] as Record<string, any>[],
  permission: null as null | ((...args: unknown[]) => void),
  loaded: [] as string[],
}));

vi.mock("electron", () => {
  class BrowserWindow {
    webContents = {
      setWindowOpenHandler() {},
      on() {},
      once() {},
      send() {},
      session: { setPermissionRequestHandler: (handler: (...args: unknown[]) => void) => void (made.permission = handler) },
    };
    constructor(options: Record<string, any>) {
      made.options.push(options);
    }
    loadURL(url: string) {
      made.loaded.push(url);
      return Promise.resolve();
    }
    hide() {}
    showInactive() {}
    isVisible() {
      return false;
    }
    setBounds() {}
    setIgnoreMouseEvents() {}
    setFocusable() {}
    setOpacity() {}
    removeMenu() {}
    on() {}
    isDestroyed() {
      return false;
    }
  }
  return { BrowserWindow };
});

const { TooltipWindow } = await import("./tooltip-window");

async function open() {
  const parent = { on() {}, once() {}, getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }) };
  const tooltip = new TooltipWindow({
    parent: parent as never,
    preload: "preload.js",
    hidden: false,
    theme: () => ({}) as never,
    language: () => "en",
    source: () => ({ root: "C:/none", module: "local.example", name: "Example", bounds: { x: 0, y: 0, width: 100, height: 100 } }),
    closed() {},
  });
  await tooltip.show("owner", { id: "one", at: { x: 1, y: 1 }, content: { title: "Hello" } } as never);
  return tooltip;
}

describe("the tooltip window", () => {
  it("is sandboxed, isolated from its page, and has no node, webview or open dev tools", async () => {
    made.options.length = 0;
    await open();
    expect(made.options).toHaveLength(1);
    const prefs = made.options[0]!.webPreferences;
    expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false });
    expect(prefs.webviewTag).not.toBe(true);
    expect(prefs.nodeIntegrationInSubFrames).not.toBe(true);
    expect(prefs.nodeIntegrationInWorker).not.toBe(true);
  });

  it("has a session of its own for each window, never the default one", async () => {
    made.options.length = 0;
    await open();
    await open();
    const [first, second] = made.options.map((options) => options.webPreferences);
    expect(first.session).toBeUndefined();
    expect(first.partition).toMatch(/^tooltip-/);
    expect(second.partition).toMatch(/^tooltip-/);
    expect(first.partition).not.toBe(second.partition);
    // A "persist:" partition would keep its data on disk.
    expect(first.partition.startsWith("persist:")).toBe(false);
  });

  it("denies every permission request", async () => {
    made.permission = null;
    await open();
    expect(made.permission).toBeTypeOf("function");
    for (const permission of ["media", "geolocation", "notifications", "clipboard-read", "fullscreen", "openExternal", "midi", "hid"]) {
      const answer = vi.fn();
      made.permission!({}, permission, answer);
      expect(answer).toHaveBeenCalledExactlyOnceWith(false);
    }
  });

  it("loads only its own page, made of the tooltip document", async () => {
    made.loaded.length = 0;
    await open();
    expect(made.loaded).toEqual(["data:text/html;charset=utf-8," + encodeURIComponent(TOOLTIP_DOCUMENT)]);
  });
});

const directives = (policy: string) => new Map(policy.split(";").map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name!, sources] as const));

describe("the tooltip page's policy", () => {
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(TOOLTIP_DOCUMENT)?.[1] ?? "";
  const tooltip = directives(meta);
  const module = directives(MODULE_CSP);

  it("has one, and it is the module policy's lockdown plus fonts and pictures from data: only", () => {
    expect(meta).not.toBe("");
    expect(tooltip.get("default-src")).toEqual(["'none'"]);
    expect(tooltip.get("font-src")).toEqual(["data:"]);
    expect(tooltip.get("img-src")).toEqual(["data:"]);
    expect(tooltip.get("style-src")).toEqual(["'unsafe-inline'"]);
    for (const name of ["base-uri", "form-action"]) expect(tooltip.get(name)).toEqual(module.get(name));
    // Nothing else is opened: no scripts, connections, frames, media or workers of its own.
    expect([...tooltip.keys()].sort()).toEqual(["base-uri", "default-src", "font-src", "form-action", "img-src", "style-src"]);
  });

  it("is never wider than the module policy for the same kind of thing", () => {
    for (const [name, sources] of tooltip) {
      const same = module.get(name);
      if (!same) continue;
      // Every source it allows is one the module policy allows too, apart from 'none', which is narrower.
      for (const source of sources) if (source !== "'none'") expect(same, `${name} ${source}`).toContain(source);
    }
    expect(meta).not.toMatch(/'self'|https?:|\*|unsafe-eval|blob:/);
  });

  it("is not the policy of a page that runs its own script", () => {
    expect(tooltip.has("script-src")).toBe(false);
    expect(TOOLTIP_DOCUMENT).not.toMatch(/<script/i);
  });
});
