// The math behind ZoomPane: where the content sits and how big it is drawn.
// A point of the content at (cx, cy) shows at (x + cx * zoom, y + cy * zoom) in the pane.

export interface ZoomView {
  x: number
  y: number
  zoom: number
}

export interface Size {
  width: number
  height: number
}

export interface ZoomLimits {
  min: number
  max: number
}

/** Room left around the content when it is fitted. */
export const FIT_PADDING = 16

/** Where content too big to fit starts: its left side, its middle or its right side. */
export type ZoomAlign = "start" | "center" | "end"

/** What fitting fills: the whole content, or only its width (taller content then starts at its top). */
export type ZoomFit = "whole" | "width"

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function clampZoom(zoom: number, limits: ZoomLimits): number {
  return clamp(zoom, limits.min, limits.max)
}

/**
 * How far the content may move. "loose": an edge may reach the middle of the pane. "content": the content always
 * covers the pane where it is bigger, and is centred where it is smaller (a map that never drifts off into nothing).
 */
export type ZoomBounds = "loose" | "content"

/** Keeps the content in reach, as `bounds` says. */
export function clampPan(view: ZoomView, pane: Size, content: Size, bounds: ZoomBounds = "loose"): ZoomView {
  const width = content.width * view.zoom
  const height = content.height * view.zoom
  if (bounds === "content") {
    const axis = (at: number, size: number, room: number) => (size <= room ? (room - size) / 2 : clamp(at, room - size, 0))
    return { zoom: view.zoom, x: axis(view.x, width, pane.width), y: axis(view.y, height, pane.height) }
  }
  return {
    zoom: view.zoom,
    x: clamp(view.x, pane.width / 2 - width, pane.width / 2),
    y: clamp(view.y, pane.height / 2 - height, pane.height / 2),
  }
}

/** Zooms by `factor`, keeping the content under `at` (a point in the pane) in place. */
export function zoomAt(view: ZoomView, factor: number, at: { x: number, y: number }, limits: ZoomLimits, pane: Size, content: Size, bounds: ZoomBounds = "loose"): ZoomView {
  const zoom = clampZoom(view.zoom * factor, limits)
  const scale = zoom / view.zoom
  return clampPan({ zoom, x: at.x - (at.x - view.x) * scale, y: at.y - (at.y - view.y) * scale }, pane, content, bounds)
}

/** The zoom at which the whole content just fits the pane, edge to edge; 0 before either has a size. */
export function containZoom(pane: Size, content: Size): number {
  if (pane.width <= 0 || pane.height <= 0 || content.width <= 0 || content.height <= 0) return 0
  return Math.min(pane.width / content.width, pane.height / content.height)
}

/** A rectangle of the content, in content pixels at zoom 1. */
export interface ZoomArea {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Shows `area` as big as fits the pane with `padding` pixels around it, centred. The zoom stays
 * within `limits`, so a tiny area (or a point) zooms in only up to the maximum. Not clamped to the content.
 */
export function areaView(pane: Size, area: ZoomArea, limits: ZoomLimits, padding: number): ZoomView {
  const room = { width: Math.max(1, pane.width - 2 * padding), height: Math.max(1, pane.height - 2 * padding) }
  const zoom = clampZoom(Math.min(room.width / Math.max(area.width, 0), room.height / Math.max(area.height, 0)), limits)
  return { zoom, x: pane.width / 2 - (area.x + area.width / 2) * zoom, y: pane.height / 2 - (area.y + area.height / 2) * zoom }
}

/**
 * The whole content in view, never above 100 % and never below `floor`. Content still
 * too big at `floor` starts at the side `align` names and is centred top to bottom.
 * With `fit` "width" only the width has to fit; taller content starts at its top.
 */
export function fitView(pane: Size, content: Size, limits: ZoomLimits, floor: number, align: ZoomAlign, fit: ZoomFit = "whole"): ZoomView {
  if (content.width <= 0 || content.height <= 0) return { x: FIT_PADDING, y: FIT_PADDING, zoom: 1 }
  const room = { width: Math.max(1, pane.width - 2 * FIT_PADDING), height: Math.max(1, pane.height - 2 * FIT_PADDING) }
  const fits = Math.min(1, room.width / content.width, fit === "width" ? 1 : room.height / content.height)
  const zoom = clampZoom(Math.max(fits, floor), limits)
  const width = content.width * zoom
  const height = content.height * zoom
  const centred = (pane.width - width) / 2
  const x = width <= room.width || align === "center" ? centred : align === "start" ? FIT_PADDING : pane.width - FIT_PADDING - width
  const y = fit === "width" && height > room.height ? FIT_PADDING : (pane.height - height) / 2
  return { x, y, zoom }
}
