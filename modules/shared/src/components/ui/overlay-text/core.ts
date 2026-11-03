// The overlay text without Vue: for an overlay page that is plain DOM (`@tavora/official-ui/overlay-text`). Saved settings
// alone, with no page part or CSS, are `@tavora/official-ui/overlay-text/plan`. The Vue parts are in index.ts.
export { mountOverlayText, SCALE_VAR, type OverlayText as OverlayTextView, type OverlayTextOptions } from "./overlay-text"
export {
  carryOn,
  GROW_SLACK,
  OVERLAY_TEXT_DEFAULTS,
  OVERLAY_TEXT_MODES,
  OVERLAY_TEXT_OVERFLOWS,
  OVERLAY_TEXT_PAUSES,
  OVERLAY_TEXT_SPEEDS,
  pauseStep,
  planText,
  readOverlayTextSettings,
  SCROLL_SPEED,
  scrollRound,
  type OverlayTextAlign,
  type OverlayTextMode,
  type OverlayTextOverflow,
  type OverlayTextSettings as OverlayTextSettingsValue,
  type OverlayTextSpeed,
  type TextPlan,
} from "./plan"
