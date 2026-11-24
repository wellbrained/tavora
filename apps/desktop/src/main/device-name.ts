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
 * The longest name, in characters: a network name is at most 255 bytes anyway, and a Mac's computer name of any length
 * goes into the files of adding a PC through a folder, which Tavora reads only up to a size (pairing.ts MAX_STEP_FILE).
 */
export const MAX_DEVICE_NAME = 255;

/** At most MAX_DEVICE_NAME characters, cut between characters, never inside one. */
const capped = (name: string) => (name.length <= MAX_DEVICE_NAME ? name : [...name].slice(0, MAX_DEVICE_NAME).join(""));

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
