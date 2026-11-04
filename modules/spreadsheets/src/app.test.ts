// @vitest-environment jsdom
// The whole panel on the SDK's memory host: it opens what the panel state says, draws the cells, keeps typing, and
// reads its state back after a reload.
import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App as VueApp } from "vue";
import { newSpreadsheet, parseSpreadsheet } from "./model";

let memory = createMemoryHost();
vi.mock("@tavora/official-ui", async (load) => {
  const real = await load<typeof import("@tavora/official-ui")>();
  return { ...real, connectModule: (options: Parameters<typeof real.connectModule>[0]) => real.connectModule({ ...options, sdk: memory.sdk }) };
});

const { default: App } = await import("./App.vue");

const box = { width: 800, height: 400 };
let app: VueApp | undefined;
let root: HTMLElement;
const settle = async () => {
  for (let step = 0; step < 20; step++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

beforeEach(() => {
  // useElementSize reads the first entry: a made-up one, as wide as the box.
  const entry = { contentRect: { width: box.width, height: 44 }, borderBoxSize: [{ inlineSize: box.width, blockSize: 44 }], contentBoxSize: [{ inlineSize: box.width, blockSize: 44 }] };
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe() {
      this.callback([entry]);
    }
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => box.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => box.height });
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  root.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  app = createApp(App);
  app.mount(root);
  await settle();
}

describe("the panel", () => {
  it("shows the empty state when there is no spreadsheet yet", async () => {
    memory = createMemoryHost();
    await mount();
    expect(root.querySelector("[data-testid=empty]")?.textContent).toContain("No spreadsheets yet");
  });

  it("opens the spreadsheet and cell its state names, draws formulas and keeps what is typed", async () => {
    memory = createMemoryHost();
    const data = newSpreadsheet("Farm", "Items", "2026-11-04T00:00:00.000Z");
    data.sheets[0]!.cells = { A1: "Iron", B1: "40", C1: "=B1*2" };
    await memory.sdk.documents.put({ id: "sheet-a", title: "Farm", data: data as unknown as JsonValue });
    await memory.sdk.panel.setState({ spreadsheet: "sheet-a", sheet: "s1", cell: "B1", scroll: { top: 0, left: 0 } });
    await mount();
    const cell = (name: string) => root.querySelector(`[data-cell='${name}']`)?.textContent?.trim();
    expect(cell("0:0")).toBe("Iron");
    expect(cell("0:2")).toBe("80");
    expect((root.querySelector("[data-testid=cell-name]") as HTMLInputElement).value).toBe("B1");
    const grid = root.querySelector<HTMLElement>("[data-slot=data-grid]")!;
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "5", bubbles: true, cancelable: true }));
    await settle();
    const editor = root.querySelector<HTMLTextAreaElement>("[data-grid-editor]")!;
    editor.value = "50";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(cell("0:2")).toBe("100");
    // Gone from the screen: what was typed is saved, and the panel state names the cell below.
    app!.unmount();
    app = undefined;
    await settle();
    expect(parseSpreadsheet(memory.host.documents.get("sheet-a")!.data).sheets[0]!.cells.B1).toBe("50");
    expect(((await memory.sdk.panel.getState()) as { cell: string }).cell).toBe("B2");
  });
});
