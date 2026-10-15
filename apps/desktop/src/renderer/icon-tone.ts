// How a game's own icon sits in its tile. A picture that fills its square is
// shown edge to edge. One with see-through parts (a logo with no background)
// sits on a plain backdrop that contrasts with it: light for a dark logo, dark
// for a light one. The decision is made once per picture from a 32 px copy.

/** `opaque` fills the tile; `onDark` and `onLight` name the backdrop behind a see-through picture. */
export type IconTone = "opaque" | "onDark" | "onLight";

const SAMPLE = 32;
/** A picture with this share of solid pixels counts as filling its square, even with rounded corners. */
const SOLID_SHARE = 0.85;

/** The tone for the pixels (RGBA, row by row) of a picture drawn at SAMPLE x SAMPLE. */
export function toneOfPixels(data: ArrayLike<number>): IconTone {
  const count = Math.floor(data.length / 4);
  if (count === 0) return "onDark";
  let solid = 0;
  let weight = 0;
  let light = 0;
  for (let i = 0; i < count; i += 1) {
    const alpha = data[i * 4 + 3]!;
    if (alpha >= 250) solid += 1;
    if (alpha < 128) continue;
    const luminance = (0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!) / 255;
    weight += alpha;
    light += luminance * alpha;
  }
  if (solid / count >= SOLID_SHARE) return "opaque";
  // Nothing visible to judge: the dark backdrop is the plain choice.
  if (weight === 0) return "onDark";
  return light / weight > 0.55 ? "onDark" : "onLight";
}

const cache = new Map<string, IconTone>();

/** The tone worked out earlier for this picture, or null. */
export const toneOf = (url: string): IconTone | null => cache.get(url) ?? null;

/** Works out and remembers the tone of a loaded picture; the dark backdrop if the browser will not let it be read. */
export function iconTone(url: string, image: HTMLImageElement): IconTone {
  const known = cache.get(url);
  if (known) return known;
  let tone: IconTone = "onDark";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
      tone = toneOfPixels(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
    }
  } catch {
    // A picture that cannot be read keeps the plain dark backdrop.
  }
  cache.set(url, tone);
  return tone;
}

/** The backdrop behind a see-through picture. */
export const backdropOf = (tone: IconTone): string =>
  tone === "onLight" ? "linear-gradient(160deg, #f3f0e8, #d6d1c4)" : "linear-gradient(160deg, #2b2b31, #16161a)";
