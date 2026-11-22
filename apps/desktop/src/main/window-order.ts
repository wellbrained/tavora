/**
 * Puts Tavora's overlay windows right above a game's window in Windows' order of windows, instead of above every
 * window: while the user is in another window and overlays stay (Settings > Overlays), a window brought over the game
 * covers them as it covers the game. Windows only; koffi is loaded on the first use, never elsewhere. It only reorders
 * Tavora's own windows: the game's and everyone else's stay where they are.
 */

/** GetWindow: the window above. */
const GW_HWNDPREV = 3;
const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x8;
/** SetWindowPos's "after": the top of the usual (not always-on-top) windows. */
const HWND_TOP = 0;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const SWP_NOOWNERZORDER = 0x200;

/** The calls it makes, with window handles as numbers (a test stands in for Windows). */
export interface Windows {
  /** The window right above, or 0 at the top. */
  above(window: number): number;
  topmost(window: number): boolean;
  /** Puts `window` right below `after` (HWND_TOP: at the top of the usual windows). */
  placeBelow(window: number, after: number): void;
}

/**
 * Stacks `ours` (top first) right above `game`. Above them is the window that was above the game, so nothing else moves.
 * When that one is always on top (or there is none) they go to the top of the usual windows, which is then right above
 * the game too; placed below an always-on-top window Windows would make them always on top as well. Does nothing when
 * they are stacked so already.
 */
export function stackAbove(windows: Windows, game: number, ours: readonly number[]): void {
  if (ours.length === 0) return;
  const mine = new Set(ours);
  // Are they already right above the game, in this order? Then the window above the topmost of them is the anchor.
  let at = windows.above(game);
  let stacked = true;
  for (let index = ours.length - 1; index >= 0; index--) {
    if (at !== ours[index]) {
      stacked = false;
      break;
    }
    at = windows.above(at);
  }
  if (stacked && !mine.has(at)) return;
  // The first window above the game that isn't one of ours.
  let anchor = windows.above(game);
  while (anchor !== 0 && mine.has(anchor)) anchor = windows.above(anchor);
  let after = anchor !== 0 && !windows.topmost(anchor) ? anchor : HWND_TOP;
  for (const window of ours) {
    windows.placeBelow(window, after);
    after = window;
  }
}

interface User32 {
  getWindow: (window: number, command: number) => number;
  getWindowLong: (window: number, index: number) => number;
  setWindowPos: (window: number, after: number, x: number, y: number, width: number, height: number, flags: number) => number;
}

let user32: User32 | undefined;

function loadUser32(): User32 {
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  const lib = koffi.load("user32.dll");
  return {
    getWindow: lib.func("intptr_t __stdcall GetWindow(intptr_t window, uint32_t command)"),
    getWindowLong: lib.func("intptr_t __stdcall GetWindowLongPtrW(intptr_t window, int index)"),
    setWindowPos: lib.func("int __stdcall SetWindowPos(intptr_t window, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)"),
  };
}

/** Windows' own calls. */
export function windowsOrder(): Windows {
  user32 ??= loadUser32();
  const calls = user32;
  return {
    above: (window) => Number(calls.getWindow(window, GW_HWNDPREV)),
    topmost: (window) => (Number(calls.getWindowLong(window, GWL_EXSTYLE)) & WS_EX_TOPMOST) !== 0,
    placeBelow: (window, after) => void calls.setWindowPos(window, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER),
  };
}
