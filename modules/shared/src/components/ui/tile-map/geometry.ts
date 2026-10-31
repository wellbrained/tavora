// The math behind TileMap: which tiles to load for a view, and how pins merge into clusters.
// Everything is in world pixels: the map at its most detailed tile level, (0, 0) at the top left.
// A world point (wx, wy) shows at (view.x + wx * view.zoom, view.y + view.zoom * wy) in the pane.

import type { Size, ZoomView } from "../zoom-pane/view"

/** Where the map's pictures come from: square tiles, one at level 0, four at level 1, and so on. */
export interface TileSource {
  /** The world's width and height in pixels. */
  size: number
  /** A tile's width and height in image pixels. */
  tileSize: number
  /** The least and most detailed levels there are. */
  minLevel?: number
  maxLevel: number
  /** The picture of one tile. */
  url: (level: number, x: number, y: number) => string
}

/** A colour from the theme for a dot. */
export type MapTone = "primary" | "info" | "success" | "warning" | "destructive" | "muted"

/** One place on the map. */
export interface MapPin {
  id: string
  /** World pixels. */
  x: number
  y: number
  /** The name in the tooltip. */
  label: string
  /** "pin" shows an icon on a round badge; "dot" a small coloured dot (for many points, such as spawns). */
  kind?: "pin" | "dot"
  /** The picture of a pin; the `pin` slot can draw something else instead. */
  icon?: string
  /** A dot's colour. */
  tone?: MapTone
  /** Ticked off: shown faded with a check mark. */
  done?: boolean
}

/** One tile to draw, placed in world pixels. */
export interface PlacedTile {
  key: string
  level: number
  x: number
  y: number
  left: number
  top: number
  size: number
}

/** Pins close together on screen, drawn as one; a single pin is a group of one. */
export interface PinGroup {
  id: string
  kind: "pin" | "dot"
  /** World pixels: the middle of its pins. */
  x: number
  y: number
  pins: MapPin[]
  /** One of the pins in `highlight` (drawn on top, never merged with the rest). */
  highlighted: boolean
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * The level whose pictures are at least as sharp as the screen: the least detailed one where one image pixel covers
 * at most one device pixel. A tenth of a level of slack keeps a view just past a step from loading the next level.
 */
export function tileLevel(zoom: number, source: TileSource, pixelRatio = 1): number {
  const wanted = Math.log2((source.size * zoom * pixelRatio) / source.tileSize)
  return clamp(Math.ceil(wanted - 0.1), source.minLevel ?? 0, source.maxLevel)
}

/** The part of the world the pane shows, in world pixels. */
export function viewArea(view: ZoomView, pane: Size) {
  return { left: -view.x / view.zoom, top: -view.y / view.zoom, right: (pane.width - view.x) / view.zoom, bottom: (pane.height - view.y) / view.zoom }
}

/** The tiles of `level` that cover the pane, plus `margin` tiles around it so a short pan shows no gap. */
export function visibleTiles(view: ZoomView, pane: Size, source: TileSource, level: number, margin = 1): PlacedTile[] {
  const count = 2 ** level
  const size = source.size / count
  const area = viewArea(view, pane)
  const first = { x: clamp(Math.floor(area.left / size) - margin, 0, count - 1), y: clamp(Math.floor(area.top / size) - margin, 0, count - 1) }
  const last = { x: clamp(Math.floor(area.right / size) + margin, 0, count - 1), y: clamp(Math.floor(area.bottom / size) + margin, 0, count - 1) }
  const tiles: PlacedTile[] = []
  if (area.right < 0 || area.bottom < 0 || area.left > source.size || area.top > source.size) return tiles
  for (let y = first.y; y <= last.y; y++) {
    for (let x = first.x; x <= last.x; x++) tiles.push({ key: `${level}/${x}/${y}`, level, x, y, left: x * size, top: y * size, size })
  }
  return tiles
}

/**
 * Merges pins that fall into the same `cell` (screen pixels) at this zoom. The cells are fixed in the world, so panning
 * never regroups anything; only zooming does. Pins and dots never merge with each other, nor highlighted pins with the
 * rest, and pins in `apart` (the selected one) stay on their own. With `merge` off every pin is its own group.
 */
export function groupPins(
  pins: readonly MapPin[],
  zoom: number,
  options: { cell: number, apart?: ReadonlySet<string>, highlight?: ReadonlySet<string> | null, merge?: boolean },
): PinGroup[] {
  const step = options.cell / zoom
  const groups = new Map<string, PinGroup>()
  for (const pin of pins) {
    const kind = pin.kind ?? "pin"
    const highlighted = options.highlight?.has(pin.id) ?? false
    const alone = options.merge === false || options.apart?.has(pin.id)
    const key = alone ? `pin:${pin.id}` : `${kind}:${highlighted ? 1 : 0}:${Math.floor(pin.x / step)}:${Math.floor(pin.y / step)}`
    const group = groups.get(key)
    if (group) group.pins.push(pin)
    else groups.set(key, { id: key, kind, x: 0, y: 0, pins: [pin], highlighted })
  }
  for (const group of groups.values()) {
    group.x = group.pins.reduce((sum, pin) => sum + pin.x, 0) / group.pins.length
    group.y = group.pins.reduce((sum, pin) => sum + pin.y, 0) / group.pins.length
    if (group.pins.length === 1) group.id = `pin:${group.pins[0]!.id}`
  }
  return [...groups.values()]
}

/** The groups whose middle is on screen or up to `margin` pixels outside it. */
export function groupsInView(groups: readonly PinGroup[], view: ZoomView, pane: Size, margin = 48): PinGroup[] {
  return groups.filter((group) => {
    const x = view.x + group.x * view.zoom
    const y = view.y + group.y * view.zoom
    return x >= -margin && y >= -margin && x <= pane.width + margin && y <= pane.height + margin
  })
}

/** The pin whose picture stands for a group: the first one with the picture most of them share. */
export function groupFace(group: PinGroup): MapPin {
  const counts = new Map<string, number>()
  for (const pin of group.pins) counts.set(pin.icon ?? "", (counts.get(pin.icon ?? "") ?? 0) + 1)
  const icon = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  return group.pins.find((pin) => (pin.icon ?? "") === icon) ?? group.pins[0]!
}

/** The area around `pins`, at least `least` world pixels wide and high, centred on them. */
export function pinsArea(pins: readonly Pick<MapPin, "x" | "y">[], least: number) {
  const xs = pins.map((pin) => pin.x)
  const ys = pins.map((pin) => pin.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const width = Math.max(least, Math.max(...xs) - left)
  const height = Math.max(least, Math.max(...ys) - top)
  return { x: (left + Math.max(...xs)) / 2 - width / 2, y: (top + Math.max(...ys)) / 2 - height / 2, width, height }
}
