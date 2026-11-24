import { execFileSync } from "node:child_process";
import os from "node:os";

/**
 * The name a device goes by in the account's device list until the user renames it: the Mac's own
 * computer name ("Brain MacBook Pro"), else the network name without its network part
 * ("MacBookPro.fritz.box" is "MacBookPro"). Windows names stay as they are.
 */
export function friendlyDeviceName(hostname: string, computerName?: string | null): string {
  const named = computerName?.trim();
  if (named) return capped(named);
  const host = hostname.trim();
  return capped(host.split(".")[0]?.trim() || host);
}

/**
 * The longest name, in UTF-16 code units (a string's length): a network name is at most 255 bytes anyway, and a Mac's
 * computer name of any length goes into the files of adding a PC through a folder, which Tavora reads only up to a size
 * (pairing.ts MAX_STEP_FILE). Code units, not characters as you see them: one of those can be any length.
 */
export const MAX_DEVICE_NAME = 255;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * At most MAX_DEVICE_NAME long, cut between characters as you see them, so a family emoji or a flag isn't split. Only
 * a single character longer than that on its own is cut inside, between code points.
 */
function capped(name: string): string {
  if (name.length <= MAX_DEVICE_NAME) return name;
  let kept = "";
  for (const { segment } of graphemes.segment(name)) {
    if (kept.length + segment.length > MAX_DEVICE_NAME) break;
    kept += segment;
  }
  if (kept) return kept;
  for (const point of name) {
    if (kept.length + point.length > MAX_DEVICE_NAME) break;
    kept += point;
  }
  return kept;
}

/** The Mac's computer name from System Settings; null elsewhere or when it can't be read. */
function macComputerName(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    return execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 2000, windowsHide: true }).trim() || null;
  } catch {
    return null;
  }
}

let known: { name: string; raw: string } | null = null;
/** This device's friendly name, and the raw network name older versions signed in with (read once). */
export function thisDeviceName(): { name: string; raw: string } {
  if (!known) {
    const raw = os.hostname();
    known = { name: friendlyDeviceName(raw, macComputerName()), raw };
  }
  return known;
}
