import { describe, expect, it } from "vitest";
import { STAND_IN_PROGRAM, STAND_IN_TITLE, standInGames, standInProbe, standInWorkspace, type StandInWindow } from "./game-stand-in";
import type { Rect } from "./game-overlays";

function window(change: Partial<{ title: string; destroyed: boolean; minimized: boolean; bounds: Rect; handle: number }> = {}) {
  const state = { title: STAND_IN_TITLE, destroyed: false, minimized: false, bounds: { x: 40, y: 40, width: 800, height: 600 }, handle: 0x1234, ...change };
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(BigInt(state.handle));
  const fake: StandInWindow = {
    getTitle: () => state.title,
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    getContentBounds: () => state.bounds,
    getNativeWindowHandle: () => handle,
  };
  return { fake, state };
}

/** A screen at 150 %: the probe reports pixels, as Windows does. */
const toScreen = (rect: Rect): Rect => ({ x: rect.x * 1.5, y: rect.y * 1.5, width: rect.width * 1.5, height: rect.height * 1.5 });

describe("standInProbe", () => {
  it("reports the stand-in as the window in front, in the screen's pixels, with its handle", () => {
    const other = window({ title: "Tavora" });
    const game = window();
    const probe = standInProbe(() => [other.fake, game.fake], toScreen);
    expect(probe.look()).toEqual({ program: STAND_IN_PROGRAM, bounds: { x: 60, y: 60, width: 1200, height: 900 }, notification: null, handle: String(0x1234) });
  });

  it("finds nothing in front without a stand-in, or with one minimized or closed", () => {
    const game = window();
    const probe = standInProbe(() => [window({ title: "Tavora" }).fake, game.fake], toScreen);
    game.state.minimized = true;
    expect(probe.look()).toBeNull();
    game.state.minimized = false;
    game.state.destroyed = true;
    expect(probe.look()).toBeNull();
    expect(standInProbe(() => [], toScreen).look()).toBeNull();
  });

  it("keeps the stand-in as the game left until it is minimized", () => {
    const game = window();
    const probe = standInProbe(() => [game.fake], toScreen);
    expect(probe.kept?.()).toBeNull();
    probe.look();
    probe.keep?.();
    expect(probe.kept?.()).toEqual({ x: 60, y: 60, width: 1200, height: 900 });
    expect(probe.keptHandle?.()).toBe(String(0x1234));
    game.state.minimized = true;
    expect(probe.kept?.()).toBeNull();
    // Gone once: back in view, it is not kept again until the next keep.
    game.state.minimized = false;
    expect(probe.kept?.()).toBeNull();
    expect(probe.keptHandle?.()).toBeNull();
  });
});

describe("standInGames", () => {
  it("names the test's workspace for the stand-in's program, and asks the watcher about any other", () => {
    const games = standInGames({ gamesOf: (program) => new Set(program === "C:\\Games\\Real\\real.exe" ? ["real"] : []) }, "poe2");
    expect([...games.gamesOf(STAND_IN_PROGRAM)]).toEqual(["poe2"]);
    expect([...games.gamesOf("C:\\Games\\Real\\real.exe")]).toEqual(["real"]);
  });
});

describe("standInWorkspace", () => {
  it("takes a library id and nothing else", () => {
    expect(standInWorkspace("poe2")).toBe("poe2");
    expect(standInWorkspace("local-personal")).toBe("local-personal");
    expect(standInWorkspace(undefined)).toBeUndefined();
    expect(standInWorkspace("")).toBeUndefined();
    expect(standInWorkspace("../poe2")).toBeUndefined();
    expect(standInWorkspace("x".repeat(65))).toBeUndefined();
  });
});
