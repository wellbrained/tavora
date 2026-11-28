// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import Palette from "./Palette.vue";
import { DEFAULT_PALETTE, type PalettePlace } from "./palette";

// The palette's handle is dragged with the pointer. Letting go keeps the place; a pointer the system takes away
// (pointercancel) puts the palette back where it was and stores nothing.

let app: App | undefined;
beforeEach(() => {
  Object.defineProperty(Element.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
  Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: () => false });
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const pointer = (type: string, init: { x?: number; y?: number } = {}) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: init.x ?? 0, clientY: init.y ?? 0 }), { pointerId: 1 });

async function mount() {
  const board = document.createElement("div");
  board.innerHTML = '<div class="App-menu__left"><div class="panelColumn"></div></div>';
  document.body.append(board);
  const palette = board.querySelector(".App-menu__left") as HTMLElement;
  board.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  palette.getBoundingClientRect = () => new DOMRect(16, 100, 200, 400);
  const placed: PalettePlace[] = [];
  app = createApp(defineComponent({ render: () => h(Palette, { board, place: DEFAULT_PALETTE, onPlace: (place: PalettePlace) => placed.push(place) }) }));
  app.mount(document.createElement("div"));
  await nextTick();
  await nextTick();
  const grip = board.querySelector("[data-testid=palette-handle]") as HTMLElement;
  return { grip, palette, placed };
}

describe("Palette drag", () => {
  it("keeps the place it is let go at", async () => {
    const { grip, palette, placed } = await mount();
    grip.dispatchEvent(pointer("pointerdown", { x: 50, y: 50 }));
    grip.dispatchEvent(pointer("pointermove", { x: 90, y: 80 }));
    expect(palette.style.transform).toBe("translate(40px, 30px)");
    grip.dispatchEvent(pointer("pointerup", { x: 90, y: 80 }));
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ x: 40, y: 30 });
  });

  it("goes back and stores nothing when the system takes the pointer away", async () => {
    const { grip, palette, placed } = await mount();
    grip.dispatchEvent(pointer("pointerdown", { x: 50, y: 50 }));
    grip.dispatchEvent(pointer("pointermove", { x: 90, y: 80 }));
    grip.dispatchEvent(pointer("pointercancel"));
    expect(placed).toEqual([]);
    expect(palette.style.transform).toBe("");
  });
});
