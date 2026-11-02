// The colours of the code in Show code, as data: each is a theme token, or a mix of two (`percent` of `from`, the rest
// of `with`). They are tokens, so a theme brings its own code colours, and the unit test reads every official theme to
// make sure each kind is at least 4.5:1 on the code background, light and dark.
import type { TokenKind } from "./highlight";

export interface CodeColour {
  from: string;
  /** How much of `from`, when mixed with `with`; the rest is `with`. */
  percent?: number;
  with?: string;
}

export const CODE_COLOURS: Record<TokenKind, CodeColour> = {
  plain: { from: "foreground" },
  keyword: { from: "primary", percent: 78, with: "foreground" },
  string: { from: "success", percent: 75, with: "foreground" },
  number: { from: "destructive", percent: 65, with: "warning" },
  comment: { from: "muted-foreground" },
  punct: { from: "foreground", percent: 70, with: "background" },
  delim: { from: "primary", percent: 78, with: "foreground" },
  tag: { from: "info", percent: 80, with: "foreground" },
  component: { from: "info", percent: 50, with: "destructive" },
  attr: { from: "primary", percent: 45, with: "foreground" },
};

/** The CSS colour for a kind. */
export function cssColour(kind: TokenKind): string {
  const colour = CODE_COLOURS[kind];
  if (colour.percent === undefined || !colour.with) return `var(--${colour.from})`;
  return `color-mix(in srgb, var(--${colour.from}) ${colour.percent}%, var(--${colour.with}))`;
}

/** The colour of the line numbers: the muted text colour. */
export const NUMBER_COLOUR: CodeColour = { from: "muted-foreground" };
