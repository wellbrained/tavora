/**
 * Reads which window is in front, straight from Windows inside Tavora's own process, for game overlays
 * (game-overlay-service.ts): the program that owns it, where its client area is on screen, and whether Windows
 * thinks a full-screen game owns the screen exclusively. Like the game watcher (program-list.ts) it only reads, with
 * the same limited access Task Manager uses, and sends nothing anywhere. The one thing it changes is `focus`, which
 * gives the keyboard back to the game after the player arranged overlays. Windows only: koffi is loaded on the first
 * look, never elsewhere.
 */
import { loadWindows, programPath, type Windows } from "./program-list";
import type { Rect } from "./game-overlays";

/** The window in front. */
export interface Foreground {
  /** The full path of the program that owns it, or null when Windows won't tell (a system window). */
  program: string | null;
  /** The window's client area on screen, in physical pixels. */
  bounds: Rect;
  /** SHQueryUserNotificationState, or null when it couldn't be read (see looksExclusive). */
  notification: number | null;
  /** The window belongs to Tavora itself (a panel over the game that took the keyboard while arranging). */
  own?: boolean;
}

export interface ForegroundProbe {
  /** The window in front, or null for none or a minimized one. Throws when Windows' functions can't be loaded. */
  look(): Foreground | null;
  /** Gives the keyboard back to the window `look` found last. */
  focus(): void;
}

interface User32 {
  getForegroundWindow: () => unknown;
  getWindowThreadProcessId: (window: unknown, pid: number[]) => number;
  isIconic: (window: unknown) => number;
  getClientRect: (window: unknown, rect: Int32Array) => number;
  clientToScreen: (window: unknown, point: Int32Array) => number;
  /** The window handle as a text, to tell windows apart. */
  handleOf: (window: unknown) => string;
  setForegroundWindow: (window: unknown) => number;
  queryUserNotificationState: (state: number[]) => number;
}

function loadUser32(): User32 {
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  const user32 = koffi.load("user32.dll");
  const shell32 = koffi.load("shell32.dll");
  return {
    getForegroundWindow: user32.func("void * __stdcall GetForegroundWindow()"),
    getWindowThreadProcessId: user32.func("uint32_t __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32_t *pid)"),
    isIconic: user32.func("int __stdcall IsIconic(void *window)"),
    getClientRect: user32.func("int __stdcall GetClientRect(void *window, _Out_ int32_t *rect)"),
    clientToScreen: user32.func("int __stdcall ClientToScreen(void *window, _Inout_ int32_t *point)"),
    handleOf: (window) => String(koffi.address(window as never)),
    setForegroundWindow: user32.func("int __stdcall SetForegroundWindow(void *window)"),
    queryUserNotificationState: shell32.func("long __stdcall SHQueryUserNotificationState(_Out_ int32_t *state)"),
  };
}

/** A probe for this PC. */
export function windowsForegroundProbe(): ForegroundProbe {
  let user32: User32 | null = null;
  let windows: Windows | null = null;
  let last: unknown = null;
  // A program keeps its path while it runs, so the same window of the same process is asked about once. The window
  // counts too: Windows reuses process ids, and a new process must not be given the path of one that ended.
  let known: { handle: string; pid: number; program: string | null } | null = null;
  const name = new Uint16Array(1024);
  return {
    look() {
      user32 ??= loadUser32();
      windows ??= loadWindows();
      const window = user32.getForegroundWindow();
      const pid = [0];
      if (window) user32.getWindowThreadProcessId(window, pid);
      // One of Tavora's own windows is in front: the window found before stays the one to give the keyboard back to.
      const own = pid[0] === process.pid;
      // Nothing to give the keyboard back to unless this look finds a window.
      if (!own) last = null;
      if (!window || user32.isIconic(window) || !pid[0]) return null;
      const handle = user32.handleOf(window);
      if (known?.pid !== pid[0] || known.handle !== handle) known = { handle, pid: pid[0], program: programPath(windows, pid[0], name) };
      const size = new Int32Array(4);
      const origin = new Int32Array(2);
      if (!user32.getClientRect(window, size) || !user32.clientToScreen(window, origin)) return null;
      const state = [0];
      let notification: number | null = null;
      try {
        notification = user32.queryUserNotificationState(state) === 0 ? state[0]! : null;
      } catch {
        notification = null;
      }
      if (!own) last = window;
      return { program: known.program, bounds: { x: origin[0]!, y: origin[1]!, width: size[2]!, height: size[3]! }, notification, ...(own ? { own } : {}) };
    },
    focus() {
      if (user32 && last) user32.setForegroundWindow(last);
    },
  };
}
