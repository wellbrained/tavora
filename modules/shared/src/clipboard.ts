// Copying text and pictures from a click, in Tavora and outside it. A module panel refuses the browser's Clipboard API
// (Tavora denies a panel every browser permission), so text goes through Tavora's clipboard.writeText and pictures
// through clipboard.writeImage: one click copies once. On a Tavora older than clipboard.writeText, text is copied the old
// way, from a hidden text field, which a click still allows. Outside Tavora the browser's own Clipboard API does it.
import { TavoraError } from "@tavora/sdk";
import { kitSdk } from "./kit-sdk";

/**
 * Puts `text` on the clipboard. Call it from the click or key press that asked for it; one press copies once. Throws
 * when it didn't work (no press just before, empty text, more than 1 MiB). Needs `connectModule` in Tavora.
 */
export async function copyText(text: string): Promise<void> {
  if (text === "") throw new Error("There is nothing to copy.");
  const sdk = kitSdk();
  if (sdk?.supports("clipboard.writeText")) {
    try {
      return await sdk.clipboard.writeText(text);
    } catch (error) {
      // A Tavora that has the call refuses for a reason (no click, too long): that stands. Only one that turned out not
      // to have it after all falls back.
      if (!(error instanceof TavoraError && error.code === "UNKNOWN_METHOD")) throw error;
    }
  }
  if (!sdk) {
    try {
      return await navigator.clipboard.writeText(text);
    } catch {
      // Falls through to the old way.
    }
  }
  copyTheOldWay(text);
}

/**
 * Puts a PNG on the clipboard. Call it from the click or key press that asked for it; one press copies once. Throws
 * when it didn't work (no press just before, not a PNG, too big: 20 MB and 16384 px a side at most).
 */
export async function copyImage(png: Blob): Promise<void> {
  const sdk = kitSdk();
  if (sdk) return sdk.clipboard.writeImage(png);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** Copies from a hidden text field, then gives the focus back to where it was. */
function copyTheOldWay(text: string): void {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  const focused = document.activeElement as HTMLElement | null;
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
  }
  if (!copied) throw new Error("The clipboard said no.");
}
