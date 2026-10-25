// Discord pictures come as PNGs of up to 256 KB, far too big for an overlay's 16 KB state. This shrinks one to a tiny
// square for the overlay (a few hundred bytes). Runs in the panel, which has a canvas; the overlay page only draws it.

export const TINY = 32;

export function shrinkAvatar(source: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(null);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = TINY;
        canvas.height = TINY;
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, TINY, TINY);
        const url = canvas.toDataURL("image/webp", 0.7);
        resolve(url.startsWith("data:image/webp") ? url : canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}
