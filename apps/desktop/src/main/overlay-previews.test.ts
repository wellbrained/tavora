import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OverlayStore } from "./overlays";
import { OverlayPreviews, type PreviewRequest, type PreviewWindow } from "./overlay-previews";
import type { StreamingModule } from "./streaming";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-previews-"));
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const CLOCK: StreamingModule = {
  owner: "official",
  root: "/nowhere",
  manifest: { id: "tavora.clock-counter", name: "Clock & Counter", overlay: "dist/overlay.html", permissions: { network: [], connectors: [] } },
};
const NOTES: StreamingModule = { owner: "official", root: "/nowhere", manifest: { id: "tavora.notes", name: "Notes", permissions: { network: [] } } };
const subject = (key = "item-1", moduleId = CLOCK.manifest.id) => ({ owner: "official", moduleId, workspaceId: "elden", key });

class FakeWindow implements PreviewWindow {
  focused = 0;
  destroyed = false;
  constructor(readonly request: PreviewRequest) {}
  focus() {
    this.focused++;
  }
  destroy() {
    this.destroyed = true;
  }
}

async function setup() {
  const overlays = await OverlayStore.load(dir);
  const modules = new Map<string, StreamingModule>([[CLOCK.manifest.id, CLOCK], [NOTES.manifest.id, NOTES]]);
  const windows: FakeWindow[] = [];
  const previews = new OverlayPreviews({
    overlays,
    module: (id) => modules.get(id),
    openWindow: (request) => {
      const window = new FakeWindow(request);
      windows.push(window);
      return window;
    },
  });
  return { previews, overlays, modules, windows };
}

describe("overlay previews", () => {
  it("opens a window titled with the module's name, with the page and the live state of its overlay", async () => {
    const { previews, overlays, windows } = await setup();
    previews.show(subject());
    expect(windows).toHaveLength(1);
    const { request } = windows[0]!;
    expect(request.title).toBe("Clock & Counter");
    expect(request.source.page()).toEqual({ root: "/nowhere", entry: "dist/overlay.html" });
    const heard: unknown[] = [];
    request.source.watch((state) => void heard.push(state));
    overlays.publish(subject(), { value: 3 });
    expect(request.source.state()).toEqual({ value: 3 });
    expect(heard).toEqual([{ value: 3 }]);
  });

  it("opens one window per overlay and brings the same one forward", async () => {
    const { previews, windows } = await setup();
    previews.show(subject());
    previews.show(subject());
    expect(windows).toHaveLength(1);
    expect(windows[0]!.focused).toBe(1);
    previews.show(subject("item-2"));
    expect(windows).toHaveLength(2);
    windows[0]!.request.closed();
    expect(previews.isOpen(subject())).toBe(false);
    previews.show(subject());
    expect(windows).toHaveLength(3);
  });

  it("refuses a module without an overlay page in its manifest, and a module that isn't installed or is another publisher's", async () => {
    const { previews, modules, windows } = await setup();
    expect(() => previews.show(subject("item-1", NOTES.manifest.id))).toThrow(/no overlay page/);
    expect(() => previews.show(subject("item-1", "tavora.missing"))).toThrow(/not installed/);
    modules.set(CLOCK.manifest.id, { ...CLOCK, owner: "someone-else" });
    expect(() => previews.show(subject())).toThrow(/not installed/);
    expect(windows).toHaveLength(0);
  });

  it("serves nothing once the module is gone or replaced, and ends the stream when the link is gone", async () => {
    const { previews, modules, windows, overlays } = await setup();
    previews.show(subject());
    const { source } = windows[0]!.request;
    modules.set(CLOCK.manifest.id, { ...CLOCK, owner: "someone-else" });
    expect(source.page()).toBeNull();
    overlays.forget(() => true);
    expect(source.watch(() => {})).toBeNull();
  });

  it("closes the previews of a removed module, and all of them on request", async () => {
    const { previews, windows } = await setup();
    previews.show(subject());
    previews.show(subject("item-2"));
    previews.closeModule(CLOCK.manifest.id, "someone-else");
    expect(windows.every((window) => !window.destroyed)).toBe(true);
    previews.closeModule(CLOCK.manifest.id, "official");
    expect(windows.every((window) => window.destroyed)).toBe(true);
    previews.show(subject());
    previews.closeAll();
    expect(windows.at(-1)!.destroyed).toBe(true);
  });
});
