// `pnpm dev` restarts Tavora whenever its main code changes, often while the developer works or plays in another
// window. A restart brings the window back the way it was, never in the player's face: minimized stays minimized,
// and a window that wasn't the active one comes back behind the one that is, without taking the focus.
import type { BrowserWindow } from "electron";

/** How the window comes back: "front" as usual, "behind" the active window, or "minimized". */
export type WindowStart = "front" | "behind" | "minimized";

export function parseWindowStart(value: string | undefined): WindowStart | undefined {
  return value === "front" || value === "behind" || value === "minimized" ? value : undefined;
}

/** How the window is now, so the next start can match it. */
export function windowLook(window: BrowserWindow): WindowStart {
  if (window.isDestroyed() || window.isMinimized()) return "minimized";
  return window.isFocused() ? "front" : "behind";
}

const SW_SHOWMINNOACTIVE = 7;
const WPF_RESTORETOMAXIMIZED = 0x2;
const GWL_STYLE = -16;
const WS_MAXIMIZE = 0x01000000;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const SWP_SHOWWINDOW = 0x40;

interface Placement {
  length: number;
  flags: number;
  showCmd: number;
  ptMinPosition: { x: number; y: number };
  ptMaxPosition: { x: number; y: number };
  rcNormalPosition: { left: number; top: number; right: number; bottom: number };
}

interface User32 {
  placementSize: number;
  getForegroundWindow: () => number;
  getWindowPlacement: (hwnd: number, placement: Placement) => number;
  setWindowPlacement: (hwnd: number, placement: Placement) => number;
  getWindowLong: (hwnd: number, index: number) => number;
  setWindowLong: (hwnd: number, index: number, value: number) => number;
  setWindowPos: (hwnd: number, after: number, x: number, y: number, width: number, height: number, flags: number) => number;
}

let user32: User32 | undefined;

function loadUser32(): User32 {
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  const lib = koffi.load("user32.dll");
  const point = koffi.struct("TavoraPoint", { x: "int32", y: "int32" });
  const rect = koffi.struct("TavoraRect", { left: "int32", top: "int32", right: "int32", bottom: "int32" });
  const placement = koffi.struct("TavoraWindowPlacement", { length: "uint32", flags: "uint32", showCmd: "uint32", ptMinPosition: point, ptMaxPosition: point, rcNormalPosition: rect });
  return {
    placementSize: koffi.sizeof(placement),
    getForegroundWindow: lib.func("intptr_t __stdcall GetForegroundWindow()"),
    getWindowPlacement: lib.func("int __stdcall GetWindowPlacement(intptr_t hwnd, _Inout_ TavoraWindowPlacement *placement)"),
    setWindowPlacement: lib.func("int __stdcall SetWindowPlacement(intptr_t hwnd, TavoraWindowPlacement *placement)"),
    getWindowLong: lib.func("intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)"),
    setWindowLong: lib.func("intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)"),
    setWindowPos: lib.func("int __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)"),
  };
}

/**
 * Shows a window that has not been shown yet without taking the focus. `maximized` is how it was saved: a
 * minimized window opens maximized when restored, a window behind the others is maximized right away. Windows
 * only; elsewhere it shows inactive and minimizes when asked.
 */
export function showInBackground(window: BrowserWindow, how: "behind" | "minimized", maximized: boolean, workArea: () => { x: number; y: number; width: number; height: number }): void {
  if (process.platform === "win32") {
    try {
      user32 ??= loadUser32();
      const hwnd = Number(window.getNativeWindowHandle().readBigUInt64LE(0));
      if (how === "minimized") {
        const placement: Placement = { length: user32.placementSize, flags: 0, showCmd: 0, ptMinPosition: { x: 0, y: 0 }, ptMaxPosition: { x: 0, y: 0 }, rcNormalPosition: { left: 0, top: 0, right: 0, bottom: 0 } };
        user32.getWindowPlacement(hwnd, placement);
        placement.showCmd = SW_SHOWMINNOACTIVE;
        if (maximized) placement.flags |= WPF_RESTORETOMAXIMIZED;
        user32.setWindowPlacement(hwnd, placement);
        return;
      }
      // Right below the active window, so a game in front stays covered by nothing.
      const active = user32.getForegroundWindow();
      if (maximized) {
        // Maximizing the usual way would make it the active window: mark it maximized and give it the work area instead.
        const area = workArea();
        user32.setWindowLong(hwnd, GWL_STYLE, Number(user32.getWindowLong(hwnd, GWL_STYLE)) | WS_MAXIMIZE);
        user32.setWindowPos(hwnd, active, area.x, area.y, area.width, area.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
      } else {
        user32.setWindowPos(hwnd, active, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
      }
      // Shown by Windows alone, Electron still takes the window for hidden and never draws the page (0.20.53 started
      // to a blank window). Already shown, it stays where it is.
      window.showInactive();
      return;
    } catch (error) {
      console.warn("[tavora] cannot show the window in the background", error);
    }
  }
  if (how === "minimized") window.minimize();
  else window.showInactive();
}
