import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({ views: [] as { background: string; visible: boolean; url: string; added: number; loads: number; written: string[]; listeners: Map<string, () => void> }[] }));

vi.mock("electron", () => {
  class WebContentsView {
    state = { background: "", visible: true, url: "", added: 0, loads: 0, written: [] as string[], listeners: new Map<string, () => void>() };
    webContents = {
      setWindowOpenHandler: () => undefined,
      on: (event: string, listener: () => void) => void this.state.listeners.set(event, listener),
      loadURL: async (url: string) => void ((this.state.url = url), this.state.loads++),
      executeJavaScript: async (script: string) => void this.state.written.push(script),
      isDestroyed: () => false,
      close: () => undefined,
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
  const ses = { webRequest: { onBeforeRequest: () => undefined }, setPermissionRequestHandler: () => undefined, setPermissionCheckHandler: () => undefined };
  return { WebContentsView, session: { fromPartition: () => ses } };
});

const { coverPage, fireDelay, FIRE_AFTER_MS, FIRE_MIN_MS, holdFor, layoutKey, OpenTimes, PanelCover } = await import("./panel-cover");

const theme = (mode: "dark" | "light", background: string) =>
  ({ mode, tokens: { background, border: "#333", "muted-foreground": "#999" } }) as never;

describe("when the fire shows", () => {
  it("shows it from the start only when the game took long last time", () => {
    expect(fireDelay(900)).toBe(0);
    expect(fireDelay(FIRE_AFTER_MS)).toBe(FIRE_AFTER_MS);
    expect(fireDelay(200)).toBe(FIRE_AFTER_MS);
    // Never opened here: plain, and the fire fades in if it runs long.
    expect(fireDelay(undefined)).toBe(FIRE_AFTER_MS);
  });

  it("keeps the fire its minimum once it showed, and nothing before", () => {
    expect(holdFor(300, FIRE_AFTER_MS)).toBe(0);
    expect(holdFor(FIRE_AFTER_MS + 50, FIRE_AFTER_MS)).toBe(FIRE_MIN_MS - 50);
    expect(holdFor(FIRE_AFTER_MS + FIRE_MIN_MS + 1, FIRE_AFTER_MS)).toBe(0);
    expect(holdFor(100, 0)).toBe(FIRE_MIN_MS - 100);
  });
});

describe("the cover page", () => {
  it("is in the theme's colours, light or dark", () => {
    const dark = coverPage({ theme: theme("dark", "#101010"), label: "Loading PoE2…", fireAtEpoch: 0, emblem: null });
    expect(dark).toContain("background:#101010");
    expect(dark).toContain("#efb663");
    const light = coverPage({ theme: theme("light", "#fafafa"), label: "x", fireAtEpoch: 0, emblem: null });
    expect(light).toContain("background:#fafafa");
    expect(light).toContain("#a66a21");
  });

  it("stays plain with reduced motion, and keeps names and colours from becoming markup", () => {
    const page = coverPage({ theme: theme("dark", "red;}</style><script>x</script>"), label: "<img src=x onerror=alert(1)>", fireAtEpoch: 0, emblem: null });
    expect(page).toContain("@media (prefers-reduced-motion:reduce){.campfire{display:none}}");
    expect(page).not.toContain("<img src=x");
    expect(page).not.toContain("<script>x");
    expect(page).toContain("background:#000");
  });

  it("fades the fire in at the time it was given", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const page = coverPage({ theme: theme("dark", "#000"), label: "x", fireAtEpoch: 1_500, emblem: null });
    expect(page).toContain("Math.max(0,1500-Date.now())");
    vi.restoreAllMocks();
  });
});

describe("open times", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tavora-open-times-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("are kept per game and layout, whatever order the panels are in", () => {
    const a = layoutKey("poe2", [{ moduleId: "wellbrained.poe2", panelType: "tree" }, { moduleId: "tavora.notes" }]);
    const b = layoutKey("poe2", [{ moduleId: "tavora.notes", panelType: null }, { moduleId: "wellbrained.poe2", panelType: "tree" }]);
    expect(a).toBe(b);
    expect(layoutKey("satisfactory", [{ moduleId: "tavora.notes" }])).not.toBe(layoutKey("poe2", [{ moduleId: "tavora.notes" }]));
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });

  it("estimate from the last three openings and survive a restart", async () => {
    const file = path.join(dir, "open-times.json");
    const times = new OpenTimes(file);
    await times.load();
    const key = layoutKey("poe2", []);
    expect(times.estimate(key)).toBeUndefined();
    await times.record(key, 900);
    await times.record(key, 300);
    await times.record(key, 600);
    await times.record(key, 300);
    expect(times.estimate(key)).toBe(400);
    const again = new OpenTimes(file);
    await again.load();
    expect(again.estimate(key)).toBe(400);
  });

  it("ignore a damaged file", async () => {
    const file = path.join(dir, "open-times.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify({ nothex: { ms: [1], at: 1 }, ["a".repeat(24)]: { ms: ["x", -1, 50], at: 2 } }));
    const times = new OpenTimes(file);
    await times.load();
    expect(times.estimate("a".repeat(24))).toBe(50);
    expect(JSON.parse(await readFile(file, "utf8"))).toBeTruthy();
  });
});

describe("the cover", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    let now = 0;
    const parent = { addChildView: vi.fn() };
    const cover = new PanelCover({ parent: parent as never, emblem: () => null, now: () => now });
    return { cover, parent, advance: (ms: number) => ((now += ms), vi.advanceTimersByTime(ms)), state: () => made.views.at(-1)! };
  }

  it("covers the workspace on top of every panel in the theme's colour, and goes once the panels drew", () => {
    const { cover, parent, state } = setup();
    cover.setBounds({ x: 8, y: 50, width: 800, height: 600 });
    cover.start(theme("dark", "#101010"), "Loading", 100);
    expect(state().visible).toBe(true);
    expect(state().background).toBe("#101010");
    expect(parent.addChildView).toHaveBeenCalledTimes(1);
    cover.finish();
    expect(state().visible).toBe(false);
    expect(cover.covering).toBe(false);
  });

  it("waits for the workspace's place before it shows", () => {
    const { cover, state } = setup();
    cover.setBounds(null);
    cover.start(theme("dark", "#000"), "Loading", undefined);
    expect(state().visible).toBe(false);
    cover.setBounds({ x: 0, y: 0, width: 100, height: 100 });
    expect(state().visible).toBe(true);
  });

  it("keeps the fire its minimum when it had just faded in", () => {
    const { cover, advance, state } = setup();
    cover.setBounds({ x: 0, y: 0, width: 100, height: 100 });
    cover.start(theme("dark", "#000"), "Loading", undefined);
    advance(FIRE_AFTER_MS + 100);
    cover.finish();
    expect(state().visible).toBe(true);
    advance(FIRE_MIN_MS - 100);
    expect(state().visible).toBe(false);
  });

  it("goes at once for a dialog, even while holding the fire", () => {
    const { cover, advance, state } = setup();
    cover.setBounds({ x: 0, y: 0, width: 100, height: 100 });
    cover.start(theme("dark", "#000"), "Loading", 2_000);
    advance(50);
    cover.finish();
    expect(state().visible).toBe(true);
    cover.cancel();
    expect(state().visible).toBe(false);
  });

  // Loading a page again could show the view white for a frame, over the whole workspace.
  it("loads its page once and writes the next ones into it, unless the page is gone", async () => {
    const { cover, state } = setup();
    cover.setBounds({ x: 0, y: 0, width: 100, height: 100 });
    cover.start(theme("dark", "#000"), "Loading Satisfactory", undefined);
    await vi.advanceTimersByTimeAsync(0);
    cover.finish();
    cover.start(theme("dark", "#000"), "Loading Path of Exile 2", undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(state().loads).toBe(1);
    expect(state().written).toHaveLength(1);
    expect(state().written[0]).toContain("Loading Path of Exile 2");
    state().listeners.get("render-process-gone")!();
    cover.start(theme("dark", "#000"), "Loading Enshrouded", undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(state().loads).toBe(2);
    expect(state().written).toHaveLength(1);
  });
});
