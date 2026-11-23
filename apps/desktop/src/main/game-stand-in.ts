// Tests only (TAVORA_TEST_GAME_WINDOW, in a development run): a plain window the test opens in Tavora's own process
// stands in for a game in front, so an e2e test can open the in-game layer over it. The probe below reads Tavora's own
// windows only; it never looks at, opens or touches another program, and a packaged Tavora never uses it (index.ts).
import type { Rect } from "./game-overlays";
import type { Foreground, ForegroundProbe } from "./foreground";
import type { GameWatcher } from "./game-watch";

/** The title the test gives its stand-in window; the probe finds it by this. */
export const STAND_IN_TITLE = "Tavora test game";
/** The program the stand-in is said to belong to: no real file, only the name the game lookup below knows. */
export const STAND_IN_PROGRAM = "C:\\Tavora test game\\game.exe";

/** What the probe reads of a window (Electron's BrowserWindow has it). */
export interface StandInWindow {
  getTitle(): string;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  /** Its client area, in DIPs. */
  getContentBounds(): Rect;
  getNativeWindowHandle(): Buffer;
}

/** A workspace id the test may name: what library ids look like, nothing else. */
export function standInWorkspace(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) ? value : undefined;
}

/**
 * The window in front, as the foreground probe (foreground.ts) reports it, for the stand-in: in front while it is open and
 * not minimized, else nothing is. `toScreen` turns DIPs into the screen's pixels, as Windows reports a window.
 */
export function standInProbe(windows: () => readonly StandInWindow[], toScreen: (rect: Rect) => Rect): ForegroundProbe {
  const find = () => windows().find((window) => !window.isDestroyed() && window.getTitle() === STAND_IN_TITLE && !window.isMinimized()) ?? null;
  const handleOf = (window: StandInWindow) => {
    const handle = window.getNativeWindowHandle();
    return String(handle.length >= 8 ? handle.readBigUInt64LE(0) : handle.readUInt32LE(0));
  };
  let kept = false;
  return {
    look(): Foreground | null {
      const window = find();
      return window ? { program: STAND_IN_PROGRAM, bounds: toScreen(window.getContentBounds()), notification: null, handle: handleOf(window) } : null;
    },
    // The stand-in has no keyboard to give back: it is never shown.
    focus() {},
    keep() {
      kept = find() !== null;
    },
    kept() {
      const window = kept ? find() : null;
      if (!window) kept = false;
      return window ? toScreen(window.getContentBounds()) : null;
    },
    keptHandle() {
      const window = kept ? find() : null;
      return window ? handleOf(window) : null;
    },
  };
}

/** The game watcher's lookup, where the stand-in's program belongs to `workspaceId`; every other program as the watcher says. */
export function standInGames(watcher: Pick<GameWatcher, "gamesOf">, workspaceId: string): Pick<GameWatcher, "gamesOf"> {
  return { gamesOf: (program) => (program === STAND_IN_PROGRAM ? new Set([workspaceId]) : watcher.gamesOf(program)) };
}
