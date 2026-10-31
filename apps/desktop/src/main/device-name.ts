import { execFileSync } from "node:child_process";
import os from "node:os";

/**
 * The name a device goes by in the account's device list until the user renames it: the Mac's own
 * computer name ("Brain MacBook Pro"), else the network name without its network part
 * ("MacBookPro.fritz.box" is "MacBookPro"). Windows names stay as they are.
 */
export function friendlyDeviceName(hostname: string, computerName?: string | null): string {
  const named = computerName?.trim();
  if (named) return named;
  const host = hostname.trim();
  return host.split(".")[0]?.trim() || host;
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
