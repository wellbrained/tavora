// How a game's own icon sits in its tile. A picture that fills its square is
// shown edge to edge. One with see-through parts (a logo with no background)
// sits on a plain backdrop that contrasts with it: light for a dark logo, dark
// for a light one. The host decides once per picture from a small copy.

/** `opaque` fills the tile; `onDark` and `onLight` name the backdrop behind a see-through picture. */
export type IconTone = "opaque" | "onDark" | "onLight";

/** A picture with this share of solid pixels counts as filling its square, even with rounded corners. */
const SOLID_SHARE = 0.75;

/**
 * The tone for the pixels of a picture as the host's bitmap gives them: blue, green, red and alpha
 * for each pixel, with the colours already multiplied by the alpha.
 */
export function toneOfBitmap(data: ArrayLike<number>): IconTone {
  const count = Math.floor(data.length / 4);
  if (count === 0) return "onDark";
  let solid = 0;
  let weight = 0;
  let light = 0;
  for (let i = 0; i < count; i += 1) {
    const alpha = data[i * 4 + 3]!;
    if (alpha >= 250) solid += 1;
    if (alpha < 128) continue;
    // Undo the multiplication to get the colour the picture shows.
    const scale = 255 / alpha;
    const blue = Math.min(255, data[i * 4]! * scale);
    const green = Math.min(255, data[i * 4 + 1]! * scale);
    const red = Math.min(255, data[i * 4 + 2]! * scale);
    weight += alpha;
    light += ((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255) * alpha;
  }
  if (solid / count >= SOLID_SHARE) return "opaque";
  // Nothing visible to judge: the dark backdrop is the plain choice.
  if (weight === 0) return "onDark";
  return light / weight > 0.55 ? "onDark" : "onLight";
}
