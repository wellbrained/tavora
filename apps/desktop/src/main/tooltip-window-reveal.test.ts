import { beforeEach, describe, expect, it, vi } from "vitest";

// How the tooltip window comes into sight: once, at the card's final size and place, and never hidden and shown again
// between one card and the next (that read as a card opening, vanishing and opening again).
const made = vi.hoisted(() => ({
  log: [] as string[],
  ipc: null as null | ((event: unknown, channel: string, ...args: unknown[]) => void),
  visible: false,
  bounds: { x: 0, y: 0, width: 0, height: 0 },
}));

vi.mock("electron", () => {
  class BrowserWindow {
    webContents = {
      setWindowOpenHandler() {},
      on(channel: string, fn: (event: unknown, channel: string, ...args: unknown[]) => void) {
        if (channel === "ipc-message") made.ipc = fn;
      },
      once() {},
      send(channel: string, ...args: unknown[]) {
        made.log.push(`send ${channel} ${JSON.stringify(channel === "tooltip:render" ? (args[0] as { serial: number }).serial : args)}${channel === "tooltip:render" && (args[0] as { keep?: boolean }).keep ? " keep" : ""}`);
      },
      insertCSS: () => Promise.resolve("key"),
      removeInsertedCSS: () => Promise.resolve(),
      session: { setPermissionRequestHandler() {} },
    };
    loadURL() {
      return Promise.resolve();
    }
    hide() {
      made.visible = false;
      made.log.push("hide");
    }
    showInactive() {
      made.visible = true;
      made.log.push("show");
    }
    isVisible() {
      return made.visible;
    }
    setOpacity(value: number) {
      made.log.push(`opacity ${value}`);
    }
    setBounds(bounds: typeof made.bounds) {
      made.bounds = bounds;
      made.log.push(`bounds ${bounds.width}x${bounds.height}`);
    }
    setIgnoreMouseEvents(ignore: boolean) {
      made.log.push(`ignore ${ignore}`);
    }
    setFocusable(focusable: boolean) {
      made.log.push(`focusable ${focusable}`);
    }
    removeMenu() {}
    on() {}
    isFocused() {
      return false;
    }
    isDestroyed() {
      return false;
    }
  }
  return { BrowserWindow };
});

const { TooltipWindow } = await import("./tooltip-window");

const parent = { on() {}, once() {}, isDestroyed: () => false, isFocused: () => true, getContentBounds: () => ({ x: 0, y: 0, width: 1600, height: 900 }) };
function tooltipWindow() {
  return new TooltipWindow({
    parent: parent as never,
    preload: "preload.js",
    hidden: false,
    theme: () => ({ font: undefined }) as never,
    language: () => "en",
    source: () => ({ root: "C:/none", module: "local.example", name: "Example", bounds: { x: 0, y: 0, width: 800, height: 800 } }),
    closed() {},
  });
}
/** The page says something, as the tooltip preload would. */
const page = (channel: string, ...args: unknown[]) => made.ipc!({}, channel, ...args);
const request = (id: string, x = 100) => ({ id, at: { x, y: 100 }, content: { title: id } }) as never;
/** The serial of the last card the window sent its page. */
const lastSerial = () => Number(made.log.filter((line) => line.startsWith("send tooltip:render")).at(-1)!.split(" ")[2]);
/** Shows a card and brings it into sight, as the page would. */
async function shown(tooltip: InstanceType<typeof TooltipWindow>, id: string, owner = "owner") {
  await tooltip.show(owner, request(id));
  page("tooltip:ready");
  page("tooltip:size", lastSerial(), 140, 260, true);
  page("tooltip:drawn", lastSerial());
}
const since = (mark: number) => made.log.slice(mark);

beforeEach(() => {
  made.log.length = 0;
  made.visible = false;
});

describe("the tooltip window coming into sight", () => {
  it("stays see-through until the card is laid out and drawn at its final size", async () => {
    const tooltip = tooltipWindow();
    await tooltip.show("owner", request("one"));
    page("tooltip:ready");
    const serial = lastSerial();
    expect(made.log).toContain("opacity 0");
    // A first measure, before the letters and pictures are in: placed, still unseen.
    page("tooltip:size", serial, 100, 200, false);
    expect(made.log).not.toContain("opacity 1");
    expect(made.log.some((line) => line.startsWith("send tooltip:placed"))).toBe(false);
    // Its final size: placed there, then the page is asked to say once it has drawn there.
    page("tooltip:size", serial, 140, 260, true);
    expect(made.bounds).toMatchObject({ width: 260, height: 140 });
    expect(made.log.at(-1)).toBe(`send tooltip:placed [${serial}]`);
    expect(made.log).not.toContain("opacity 1");
    page("tooltip:drawn", serial);
    expect(made.log.at(-1)).toBe("opacity 1");
    expect(made.log).not.toContain("hide");
  });

  it("keeps a card in sight while the next one takes its place, and is never hidden in between", async () => {
    const tooltip = tooltipWindow();
    await tooltip.show("owner", request("one"));
    page("tooltip:ready");
    page("tooltip:size", lastSerial(), 140, 260, true);
    page("tooltip:drawn", lastSerial());
    const mark = made.log.length;
    // The same card asked for again (a module that shows on each move), then the next one.
    await tooltip.show("owner", request("one"));
    page("tooltip:size", lastSerial(), 140, 260, true);
    await tooltip.show("owner", request("two", 300));
    page("tooltip:size", lastSerial(), 180, 300, true);
    expect(since(mark)).not.toContain("hide");
    expect(since(mark)).not.toContain("opacity 0");
    // The page keeps the card in sight until the window is placed for the next one.
    expect(since(mark).filter((line) => line.startsWith("send tooltip:render")).every((line) => line.endsWith(" keep"))).toBe(true);
    expect(made.bounds).toMatchObject({ width: 300, height: 180 });
  });

  it("swaps in place when the module hides the card and shows the next one (pointer leaves one item, enters the next)", async () => {
    vi.useFakeTimers();
    try {
      const tooltip = tooltipWindow();
      await shown(tooltip, "one");
      const mark = made.log.length;
      tooltip.close("owner", "one", false, true);
      await tooltip.show("owner", request("two", 300));
      page("tooltip:size", lastSerial(), 180, 300, true);
      vi.advanceTimersByTime(500);
      expect(since(mark)).not.toContain("hide");
      expect(since(mark)).not.toContain("opacity 0");
      expect(made.log.filter((line) => line.startsWith("send tooltip:render")).at(-1)).toMatch(/ keep$/);
      expect(made.bounds).toMatchObject({ width: 300, height: 180 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides a card the module took away once no next one came", async () => {
    vi.useFakeTimers();
    try {
      const tooltip = tooltipWindow();
      await shown(tooltip, "one");
      tooltip.close("owner", "one", false, true);
      expect(made.log.at(-1)).not.toBe("hide");
      vi.advanceTimersByTime(60);
      expect(made.log.at(-1)).toBe("hide");
      // The next card starts unseen again.
      const mark = made.log.length;
      await tooltip.show("owner", request("two"));
      expect(since(mark)).toContain("opacity 0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts unseen when another panel's card follows one that is going", async () => {
    const tooltip = tooltipWindow();
    await shown(tooltip, "one");
    tooltip.close("owner", "one", false, true);
    const mark = made.log.length;
    await tooltip.show("other", request("two"));
    expect(since(mark)).toContain("opacity 0");
    expect(made.log.filter((line) => line.startsWith("send tooltip:render")).at(-1)).not.toMatch(/ keep$/);
  });

  it("starts unseen when another panel's card replaces one that is still in sight", async () => {
    const tooltip = tooltipWindow();
    await shown(tooltip, "one");
    const mark = made.log.length;
    await tooltip.show("other", request("two"));
    // Not drawn over the old card: see-through and click-through until it is drawn, and not kept over the old one.
    expect(since(mark)).toContain("opacity 0");
    expect(since(mark)).toContain("ignore true");
    expect(made.log.filter((line) => line.startsWith("send tooltip:render")).at(-1)).not.toMatch(/ keep$/);
    page("tooltip:size", lastSerial(), 140, 260, true);
    page("tooltip:drawn", lastSerial());
    expect(made.log.at(-1)).toBe("opacity 1");
  });

  it("hides at once when Tavora closes it, and never shows a card closed while it waited to be drawn", async () => {
    vi.useFakeTimers();
    try {
      const tooltip = tooltipWindow();
      await tooltip.show("owner", request("one"));
      page("tooltip:ready");
      const serial = lastSerial();
      page("tooltip:size", serial, 140, 260, true);
      tooltip.close();
      expect(made.log.at(-1)).toBe("hide");
      page("tooltip:drawn", serial);
      vi.advanceTimersByTime(500);
      expect(made.log).not.toContain("opacity 1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only the newer card when an unseen one is replaced before it was drawn", async () => {
    vi.useFakeTimers();
    try {
      const tooltip = tooltipWindow();
      await tooltip.show("owner", request("one"));
      page("tooltip:ready");
      const first = lastSerial();
      page("tooltip:size", first, 140, 260, true);
      await tooltip.show("owner", request("two", 300));
      const second = lastSerial();
      page("tooltip:drawn", first);
      vi.advanceTimersByTime(500);
      expect(made.log).not.toContain("opacity 1");
      page("tooltip:size", second, 180, 300, true);
      page("tooltip:drawn", second);
      expect(made.log.at(-1)).toBe("opacity 1");
      expect(made.bounds).toMatchObject({ width: 300, height: 180 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is placed beside the new anchor before it draws, so the old card never shows at the new place", async () => {
    const tooltip = tooltipWindow();
    await tooltip.show("owner", request("one"));
    page("tooltip:ready");
    page("tooltip:size", lastSerial(), 140, 260, true);
    page("tooltip:drawn", lastSerial());
    tooltip.close();
    expect(made.log.at(-1)).toBe("hide");
    const mark = made.log.length;
    await tooltip.show("owner", request("two", 300));
    // See-through before it is shown again: the page still holds the last card's frame.
    const shown = since(mark);
    expect(shown.indexOf("opacity 0")).toBeGreaterThanOrEqual(0);
    expect(shown.indexOf("opacity 0")).toBeLessThan(shown.indexOf("show"));
    page("tooltip:size", lastSerial(), 180, 300, true);
    expect(since(mark)).not.toContain("opacity 1");
    page("tooltip:drawn", lastSerial());
    expect(made.log.at(-1)).toBe("opacity 1");
  });

  it("takes clicks and keys for a pinned card only once it is in sight", async () => {
    const tooltip = tooltipWindow();
    await tooltip.show("owner", { ...(request("pin") as object), pinned: true } as never);
    page("tooltip:ready");
    expect(made.log).not.toContain("ignore false");
    expect(made.log).not.toContain("focusable true");
    page("tooltip:size", lastSerial(), 140, 260, true);
    page("tooltip:drawn", lastSerial());
    expect(made.log.slice(-3)).toEqual(["ignore false", "focusable true", "opacity 1"]);
  });

  it("comes into sight anyway when the page never says it drew", async () => {
    vi.useFakeTimers();
    try {
      const tooltip = tooltipWindow();
      await tooltip.show("owner", request("one"));
      page("tooltip:ready");
      page("tooltip:size", lastSerial(), 140, 260, true);
      expect(made.log).not.toContain("opacity 1");
      vi.advanceTimersByTime(200);
      expect(made.log.at(-1)).toBe("opacity 1");
    } finally {
      vi.useRealTimers();
    }
  });
});
