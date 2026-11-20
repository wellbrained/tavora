// The corner radius of the native views over the host page: module panels (module-view.ts), Browser pages
// (browser-view.ts) and the loading cover (panel-cover.ts). They can't take the host page's CSS, so they get their corner
// from here, matching the panel cards dock.css draws (docs/features/style-system.md, "Native panel corners").
import { CLASSIC_STYLE_ID } from "../shared/styles";
import type { PanelStyle } from "./library";

export interface PanelCorners {
  /** A module panel's view. */
  module: number;
  /** A Browser panel's page, below its toolbar. */
  page: number;
  /** The loading cover over the workspace. */
  cover: number;
}

/**
 * Classic's corners for each panel style, as dock.css draws them. Classic: the card rounds by 10 px with a 1 px border,
 * so what is inside rounds by 9. Framed and Folders: the module and the page sit in the frame with --panel-body-radius,
 * 9 px. The cover rounds like a card's outside, 10.
 */
const CLASSIC: Record<PanelStyle, PanelCorners> = {
  classic: { module: 9, page: 9, cover: 10 },
  framed: { module: 9, page: 9, cover: 10 },
  folders: { module: 9, page: 9, cover: 10 },
};

/**
 * The corners for a style, the user's panel style and the corner radius in use (shared/styles.ts `resolveRadius`).
 * Classic keeps today's corners for each panel style, whatever the radius, as dock.css does. Every other style draws
 * Framed's frame whatever panel style is saved, with the module body at the radius (`--panel-body-radius: var(--radius)`):
 * the module, the page and the cover all round by the radius, 0 being square.
 */
export function panelCorners(style: { id: string }, panelStyle: PanelStyle, radius: number): PanelCorners {
  if (style.id === CLASSIC_STYLE_ID) return { ...(CLASSIC[panelStyle] ?? CLASSIC.classic) };
  const corner = Math.max(0, Math.round(Number.isFinite(radius) ? radius : 0));
  return { module: corner, page: corner, cover: corner };
}
