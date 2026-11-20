// Design styles (docs/features/style-system.md): what the host main and the host page both need to turn the user's
// settings into the corner radius and font in use. The style files themselves are read in main/styles.ts.
// The host page imports this too, so it takes nothing but types from the SDK (styles.test.ts checks the id).

/** Classic, today's look: the style a library without one, and Reset, mean. The SDK's CLASSIC_STYLE.id. */
export const CLASSIC_STYLE_ID = "tavora.classic";

/** The corner radius in px a style, or the user over it, may set (Settings > Appearance). 0 is square. */
export const STYLE_RADIUS = { min: 0, max: 16 } as const;

/** Whether a value is a corner radius a style, or the user over it, may set. */
export const isStyleRadius = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= STYLE_RADIUS.min && (value as number) <= STYLE_RADIUS.max;

/** The parts of a style that resolving needs. */
export interface StyleDefaults {
  id: string;
  /** The style's corner radius in px. Classic keeps the theme variation's instead. */
  radius: number;
  /** The style's font id (shared/ui-fonts.ts). */
  font: string;
}

/**
 * The corner radius in use: the user's own (`override`), else the style's. Classic keeps the theme variation's, so a
 * library from before styles looks as it did.
 */
export function resolveRadius(override: number | null | undefined, style: Pick<StyleDefaults, "id" | "radius">, variationRadius: number): number {
  if (typeof override === "number") return override;
  return style.id === CLASSIC_STYLE_ID ? variationRadius : style.radius;
}

/** The font id in use: the user's own (`override`), else the style's (Classic's is Inter). */
export function resolveFontId(override: string | null | undefined, style: Pick<StyleDefaults, "font">): string {
  return override ?? style.font;
}
