// A picture drawn on a canvas, as a PNG for copyImage or Save as image. The module draws in its own units (CSS pixels);
// this waits for the fonts, draws twice as sharp so it still reads well pasted into a chat, and stays within what
// Tavora's clipboard and save dialog take.

/** What renderToImage draws. */
export interface RenderToImageOptions {
  /** The picture's size in the units `draw` uses (CSS pixels). */
  width: number;
  height: number;
  /** Draws the picture; the context is already scaled, so draw in `width` × `height`. */
  draw(ctx: CanvasRenderingContext2D): void | Promise<void>;
  /** How much sharper than its size it is drawn; default 2. It is lowered when the picture would get too big. */
  scale?: number;
  /**
   * Fonts `draw` uses, as CSS font shorthands ("700 30px Inter Variable"), loaded before it draws. The kit's Inter is
   * always loaded. A font the page never showed isn't loaded otherwise, and the canvas would fall back to another one.
   */
  fonts?: string[];
}

/** The biggest picture renderToImage makes: well within Tavora's 16384 px a side and 20 MB, and quick to copy. */
export const IMAGE_LIMITS = { side: 8192, pixels: 32_000_000 } as const;

const KIT_FONTS = ["400", "500", "600", "700"].map((weight) => `${weight} 16px "Inter Variable"`);

/** The scale actually used for a picture of this size: `wanted`, unless that would go past IMAGE_LIMITS. */
export function imageScale(width: number, height: number, wanted = 2, limits: { side: number; pixels: number } = IMAGE_LIMITS): number {
  return Math.min(wanted, limits.side / Math.max(width, height), Math.sqrt(limits.pixels / (width * height)));
}

/** Draws a picture and resolves with it as a PNG. Throws when the size isn't a positive number or the browser can't make it. */
export async function renderToImage(options: RenderToImageOptions): Promise<Blob> {
  const { width, height } = options;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) throw new Error("A picture needs a width and a height.");
  await Promise.all([...KIT_FONTS, ...(options.fonts ?? [])].map((font) => document.fonts?.load(font).catch(() => [])));
  const scale = imageScale(width, height, options.scale ?? 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The picture could not be made.");
  ctx.scale(canvas.width / width, canvas.height / height);
  await options.draw(ctx);
  return new Promise((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("The picture could not be made."))), "image/png"));
}
