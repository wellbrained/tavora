import type { WebContentsView } from "electron";
import { encodePng } from "./png-encode";

/** A still image of a panel's page as a lossless data: URL (it stands in for the page, so it must look the same), or null when there is none. */
export async function stillOf(view: WebContentsView): Promise<string | null> {
  const image = await view.webContents.capturePage().catch(() => null);
  if (!image || image.isEmpty()) return null;
  // The capture's only bitmap is its 1x one, in device pixels: the host UI shows it at that size over the pixel ratio.
  const { width, height } = image.getSize();
  const png = await encodePng(image.toBitmap(), width, height).catch(() => null);
  return png ? `data:image/png;base64,${png.toString("base64")}` : null;
}
