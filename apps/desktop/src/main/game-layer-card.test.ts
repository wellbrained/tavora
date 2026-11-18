import { describe, expect, it, vi } from "vitest";
import { layerCardContent } from "../shared/layer-card";

// The card's window needs a little of Electron: a window with its page, and messages from that page.
const world = vi.hoisted(() => ({ windows: [] as unknown[] }));

vi.mock("electron", () => {
  class BrowserWindow {
    handlers = new Map<string, ((...args: never[]) => void)[]>();
    ipc = new Map<string, (event: unknown, ...args: unknown[]) => void>();
    sent: unknown[] = [];
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    visible = false;
    ignoring: { ignore: boolean; forward: boolean } | null = null;
    gone = false;
    raised = 0;
    contentsHandlers = new Map<string, (...args: unknown[]) => void>();
    webContents = {
      setWindowOpenHandler: () => undefined,
      on: (name: string, fn: (...args: unknown[]) => void) => void this.contentsHandlers.set(name, fn),
      loadURL: async () => undefined,
      isDestroyed: () => this.gone,
      close: () => undefined,
      send: (_channel: string, state: unknown) => void this.sent.push(state),
      ipc: { on: (channel: string, fn: (event: unknown, ...args: unknown[]) => void) => void this.ipc.set(channel, fn) },
    };
    constructor(readonly options: unknown) {
      world.windows.push(this);
    }
    on(name: string, fn: (...args: never[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
    }
    once(name: string, fn: (...args: never[]) => void) {
      this.on(name, fn);
    }
    emit(name: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(name) ?? []) (fn as (...a: unknown[]) => void)(...args);
    }
    removeMenu() {}
    setAlwaysOnTop() {}
    setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }) {
      this.ignoring = { ignore, forward: options?.forward ?? false };
    }
    setOpacity() {}
    isDestroyed() {
      return this.gone;
    }
    isVisible() {
      return this.visible;
    }
    isFocused() {
      return false;
    }
    showInactive() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    moveTop() {
      this.raised++;
    }
    setBounds(rect: { x: number; y: number; width: number; height: number }) {
      this.bounds = rect;
    }
    getBounds() {
      return this.bounds;
    }
    destroy() {
      this.gone = true;
      this.emit("closed");
    }
  }
  return { BrowserWindow, app: { on: () => undefined, removeListener: () => undefined } };
});

const { GameLayerCard } = await import("./game-layer-card");

type Raw = {
  ipc: Map<string, (event: unknown, ...args: unknown[]) => void>;
  sent: { mode: string; scheme: string; colors: Record<string, string>; radius: number; font: string; language: string; keys: string[] }[];
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  ignoring: { ignore: boolean; forward: boolean } | null;
  raised: number;
  contentsHandlers: Map<string, (...args: unknown[]) => void>;
  emit(name: string, ...args: unknown[]): void;
};

const TOP = { senderFrame: { parent: null } };
const INNER = { senderFrame: { parent: {} } };

function make() {
  const asked: string[] = [];
  const card = new GameLayerCard({
    preload: "layer-card.cjs",
    address: "tavora-host://app/layer-card.html",
    hidden: true,
    devTools: false,
    theme: () => ({ mode: "light", colors: {} as never, tokens: { card: "#fff", border: "#ddd" } as never, radius: 6, font: { family: '"Rubik Variable", sans-serif' } as never }),
    language: () => "de",
    setMode: (mode) => void asked.push(mode),
    close: () => void asked.push("close"),
    ended: () => void asked.push("ended"),
  });
  const raw = world.windows.at(-1) as Raw;
  const send = (channel: string, ...args: unknown[]) => raw.ipc.get(channel)!(TOP, ...args);
  return { card, raw, asked, send };
}

const AREA = { x: 100, y: 50, width: 1280, height: 720 };

describe("the layer card's window", () => {
  it("lets clicks through until the pointer is over the card", () => {
    const { raw, send } = make();
    expect(raw.ignoring).toEqual({ ignore: true, forward: true });
    send("layer-card:hover", true);
    expect(raw.ignoring).toEqual({ ignore: false, forward: false });
    send("layer-card:hover", false);
    expect(raw.ignoring).toEqual({ ignore: true, forward: true });
  });

  it("sends the page its content in the theme and language once it is ready, and shows only after the page measured the card", () => {
    const { card, raw, send } = make();
    card.show(AREA, layerCardContent("de", "use", "Ctrl+Shift+T"));
    expect(raw.sent).toHaveLength(0);
    send("layer-card:ready");
    expect(raw.sent.at(-1)).toMatchObject({ mode: "use", scheme: "light", colors: { card: "#fff" }, radius: 6, font: '"Rubik Variable", sans-serif', language: "de", keys: ["Ctrl", "Shift", "T"] });
    expect(raw.visible).toBe(false);
    send("layer-card:extent", { width: 320, height: 40 });
    expect(raw.visible).toBe(true);
    expect(raw.bounds).toMatchObject({ y: 54, width: 368 });
    expect(raw.bounds.x + raw.bounds.width / 2).toBe(AREA.x + AREA.width / 2);
    // The same content again sends nothing; a new mode does.
    const count = raw.sent.length;
    card.show(AREA, layerCardContent("de", "use", "Ctrl+Shift+T"));
    expect(raw.sent).toHaveLength(count);
    card.show(AREA, layerCardContent("de", "arrange", "Ctrl+Shift+T"));
    expect(raw.sent.at(-1)?.mode).toBe("arrange");
    card.refresh();
    expect(raw.sent).toHaveLength(count + 2);
    card.raise();
    expect(raw.raised).toBe(1);
  });

  it("passes on a mode or Close from the page's own top frame only, and only a real mode", () => {
    const { raw, asked, send } = make();
    send("layer-card:mode", "arrange");
    send("layer-card:mode", "off");
    send("layer-card:close");
    raw.ipc.get("layer-card:mode")!(INNER, "use");
    raw.ipc.get("layer-card:close")!(INNER);
    expect(asked).toEqual(["arrange", "close"]);
  });

  it("hides and tells the service when its page crashed, so a new card is made", () => {
    const { card, raw, asked, send } = make();
    send("layer-card:ready");
    card.show(AREA, layerCardContent("en", "use", null));
    send("layer-card:extent", { width: 320, height: 40 });
    expect(raw.visible).toBe(true);
    raw.contentsHandlers.get("render-process-gone")!({}, { reason: "crashed" });
    expect(raw.visible).toBe(false);
    expect(asked).toEqual(["ended"]);
  });

  it("can't be closed by the user, only by the layer", () => {
    const { card, raw } = make();
    const event = { preventDefault: vi.fn() };
    raw.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalled();
    card.destroy();
    expect(card.focused).toBe(false);
  });
});
