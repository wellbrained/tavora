// The look of a workspace's badge when it has no image: a tone and a quiet pattern
// derived from its id. Pure, so the same id looks the same on every PC and
// after a rename.

// Muted, warm tones that keep ivory text readable. They stay the same in every theme, so the letter does too.
export const TONES = ["#6b4f2a", "#5a3d36", "#3f4a3a", "#3b4656", "#5b4a63", "#4d4a3c", "#64422a", "#37504f"] as const;
/** The letter on a badge: Tavora's ivory in every theme. A light theme's dark text would vanish on these tones. */
export const LETTER = "#f2ece0";

const LIGHT = "rgb(255 255 255 / 0.07)";

interface Pattern {
  image: string;
  size?: string;
}

// Each pattern is a faint overlay, never loud enough to compete with the letter.
export const PATTERNS: readonly Pattern[] = [
  { image: `repeating-linear-gradient(135deg, ${LIGHT} 0 5px, transparent 5px 10px)` },
  { image: "radial-gradient(rgb(255 255 255 / 0.12) 1.5px, transparent 2px)", size: "8px 8px" },
  { image: "radial-gradient(circle at 30% 25%, rgb(255 214 140 / 0.24), transparent 62%)" },
  { image: `repeating-radial-gradient(circle at 75% 85%, ${LIGHT} 0 3px, transparent 3px 9px)` },
  {
    image: `linear-gradient(${LIGHT} 1px, transparent 1px), linear-gradient(90deg, ${LIGHT} 1px, transparent 1px)`,
    size: "8px 8px",
  },
  { image: `repeating-conic-gradient(from 0deg at 50% 100%, ${LIGHT} 0 10deg, transparent 10deg 20deg)` },
  { image: `linear-gradient(160deg, rgb(255 255 255 / 0.1) 0 50%, transparent 50%)` },
  {
    image: `linear-gradient(135deg, ${LIGHT} 25%, transparent 25%), linear-gradient(225deg, ${LIGHT} 25%, transparent 25%)`,
    size: "10px 10px",
  },
];

function hash(id: string, seed: number): number {
  let value = seed;
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

export interface BadgeLook {
  /** Background colour. */
  color: string;
  /** Overlay as CSS `background-image`. */
  image: string;
  /** Overlay as CSS `background-size`; `auto` when the overlay fills the badge. */
  size: string;
}

export function badgeLook(id: string): BadgeLook {
  // The tone keeps the hash it always had, so existing workspaces keep their colour.
  const tone = TONES[hash(id, 0) % TONES.length]!;
  // A second hash picks the pattern, so tone and pattern vary independently.
  const pattern = PATTERNS[(hash(id, 7) >>> 3) % PATTERNS.length]!;
  return { color: tone, image: pattern.image, size: pattern.size ?? "auto" };
}
