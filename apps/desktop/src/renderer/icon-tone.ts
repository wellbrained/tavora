import type { IconTone } from "../shared/icon-tone";

/** The backdrop behind a see-through game icon: light behind a dark logo, dark behind a light one. */
export const backdropOf = (tone: IconTone): string =>
  tone === "onLight" ? "linear-gradient(160deg, #f3f0e8, #d6d1c4)" : "linear-gradient(160deg, #2b2b31, #16161a)";
