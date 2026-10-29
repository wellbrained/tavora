// Both picture cards and screenshot starters use the same offline image preparation.
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import { t } from "./i18n";
import { blobToDataUrl } from "./pictures";

export interface PreparedPicture {
  binary: BinaryFileData;
  blob: Blob;
  width: number;
  height: number;
}

export async function readBoardPicture(file: File): Promise<PreparedPicture> {
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) throw new Error(t("card.imageType"));
  if (file.size > 20 * 1024 * 1024) throw new Error(t("card.imageSize"));
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(t("card.imageFailed")); });
  try {
    const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error(t("card.imageFailed"))), "image/png"));
    const binary: BinaryFileData = { id: crypto.randomUUID() as FileId, mimeType: "image/png", dataURL: await blobToDataUrl(blob) as DataURL, created: Date.now() };
    return { binary, blob, width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}
