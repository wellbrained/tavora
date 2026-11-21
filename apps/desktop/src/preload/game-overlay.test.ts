// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ send: vi.fn(), listeners: new Map<string, (...args: unknown[]) => void>() }));

vi.mock("electron", () => ({
  ipcRenderer: {
    send: ipc.send,
    on: (name: string, listener: (...args: unknown[]) => void) => void ipc.listeners.set(name, listener),
  },
}));

document.body.innerHTML = '<div id="frame"></div>';
const frame = document.getElementById("frame")!;
frame.setPointerCapture = () => undefined;
await import("./game-overlay");

const build = () => ipc.listeners.get("game-overlay:frame")!({}, "Clock", "Close", "Layout");
const pointer = (type: string) => frame.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
const drags = () => ipc.send.mock.calls.filter(([channel]) => channel === "game-overlay:drag").map(([, phase]) => phase);

describe("the in-game frame", () => {
  beforeEach(() => ipc.send.mockClear());

  it("reports one drag, however many times Arrange built it", () => {
    for (let times = 0; times < 4; times += 1) build();
    pointer("pointerdown");
    pointer("pointermove");
    pointer("pointerup");
    expect(drags()).toEqual(["start", "move", "end"]);
  });

  it("goes on with a drag when it is built again meanwhile", () => {
    build();
    pointer("pointerdown");
    build();
    pointer("pointermove");
    pointer("pointerup");
    expect(drags()).toEqual(["start", "move", "end"]);
  });
});
