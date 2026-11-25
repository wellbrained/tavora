// The SDK the kit's own helpers use (copyText, copyImage, the share menu), so a module doesn't hand it to each of them.
// connectModule sets it once it is connected; outside Tavora (a plain browser while developing) there is none, and the
// helpers fall back to what the browser can do.
import type { TavoraSDK } from "@tavora/sdk";

let current: TavoraSDK | undefined;

/** Called by connectModule (a test passes its memory host's SDK there); undefined forgets it. */
export function setKitSdk(sdk: TavoraSDK | undefined): void {
  current = sdk;
}

/** The connected SDK, or undefined outside Tavora. */
export function kitSdk(): TavoraSDK | undefined {
  return current;
}
