import { showToast } from "../../host";
import { t } from "../../i18n";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Reads a picked picture for the crop dialog; null (with a toast) if it cannot be used. */
export function readPicture(file: File): Promise<string | null> {
  if (!TYPES.includes(file.type)) return Promise.resolve(fail(t("picture.type")));
  if (file.size > MAX_FILE_BYTES) return Promise.resolve(fail(t("picture.size")));
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(fail(t("picture.read")));
    reader.readAsDataURL(file);
  });
}

function fail(message: string): null {
  showToast(message);
  return null;
}
