// Pictures come in through Tavora's own open dialog: a module page can't open the system's file picker
// (security.md, "The system's file picker").
import { TavoraError, type TavoraSDK } from "@tavora/sdk";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/**
 * The pictures the user picks in Tavora's open dialog, read once. The module keeps its own copy, so the link the
 * dialog makes is forgotten again. Empty when the dialog was closed, null when this Tavora has no such dialog (an
 * old one, where the file input still opens).
 */
export async function pickPictures(sdk: TavoraSDK, multiple: boolean): Promise<File[] | null> {
  const extensions = Object.keys(TYPES);
  let picked;
  try {
    picked = multiple ? await sdk.files.pickReadOnly({ extensions, multiple: true }) : [await sdk.files.pickReadOnly({ extensions })].filter((file) => file !== null);
  } catch (reason) {
    if (reason instanceof TavoraError && reason.code === "UNKNOWN_METHOD") return null;
    throw reason;
  }
  const files: File[] = [];
  try {
    for (const file of picked) {
      const bytes = await sdk.files.read(file.id);
      const extension = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
      files.push(new File([bytes as Uint8Array<ArrayBuffer>], file.name, { type: TYPES[extension] ?? "" }));
    }
  } finally {
    for (const file of picked) void sdk.files.forget(file.id).catch(() => undefined);
  }
  return files;
}
