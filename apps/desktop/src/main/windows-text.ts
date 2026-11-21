/**
 * The text of a Windows command-line tool (`reg`). It writes in the PC's OEM code page, 850 on German Windows, so reading
 * it as UTF-8 breaks every umlaut in a game's name or path. Windows itself turns it into text here, whichever page the
 * PC uses. A letter that page doesn't have already came out of the tool as "?". Windows only: koffi is loaded on the
 * first text that isn't plain ASCII.
 */

const CP_OEMCP = 1;

export type ToWide = (page: number, flags: number, bytes: Uint8Array, count: number, wide: Uint16Array, size: number) => number;

let windowsToWide: ToWide | null = null;

function loadToWide(): ToWide {
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  windowsToWide ??= koffi.load("kernel32.dll").func("int __stdcall MultiByteToWideChar(uint32_t page, uint32_t flags, const uint8_t *bytes, int count, _Out_ uint16_t *wide, int size)") as ToWide;
  return windowsToWide;
}

/** What the tool wrote, as text. Falls back to UTF-8 when Windows can't be asked, as it was read before. */
export function decodeConsoleText(bytes: Buffer, toWide?: ToWide): string {
  if (bytes.every((byte) => byte < 0x80)) return bytes.toString("latin1");
  try {
    // One byte never makes more than one UTF-16 unit in a code page.
    const wide = new Uint16Array(bytes.length);
    const count = (toWide ?? loadToWide())(CP_OEMCP, 0, bytes, bytes.length, wide, wide.length);
    if (count > 0) return Buffer.from(wide.buffer, 0, count * 2).toString("utf16le");
  } catch {
    // Below.
  }
  return bytes.toString("utf8");
}
