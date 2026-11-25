// What the item card's parts read from a card (`TooltipContent`, the same content the shared tooltip shows).
import type { TooltipContent, TooltipEffectRun, TooltipSkin } from "@tavora/sdk"
import { cssUrl } from "./skin-font"

export type ItemCardLayout = "card" | "unit" | "rich"
export type ItemCardStat = NonNullable<TooltipContent["properties"]>[number]

/** Whether a skin brings its own colours (a surface and a text colour, the rest filled in from them). */
export const skinColored = (skin: TooltipSkin | undefined): boolean => Boolean(skin?.colors?.surface && skin.colors.text)

/** The card's layout: "rich" unless it asks for "card" or "unit". */
export const layoutOf = (content: TooltipContent): ItemCardLayout => (content.layout === "card" || content.layout === "unit" ? content.layout : "rich")

/** The effect as runs: a plain text is one run. */
export const effectRuns = (content: TooltipContent): (TooltipEffectRun | { text: string })[] => (typeof content.effect === "string" ? [{ text: content.effect }] : (content.effect ?? []))

/** A picture used as a mask (a stat's icon, the unit's corner pictogram), made absolute against the page, so the
 * stylesheet's own address can't change what a relative path points at. Undefined when it can't be read. */
export function maskUrl(path: string | undefined): string | undefined {
  if (!path) return undefined
  try {
    return cssUrl(new URL(path, document.baseURI).href)
  } catch {
    return undefined
  }
}

/** A stat's value with its suffix: only the unit layout hangs the suffix past the value. */
export const ownValue = (stat: { value: string; suffix?: string }) => stat.value + (stat.suffix ?? "")

/** The rich layout's stat in one line, "6 · 12 · 18 · +3": an empty extra value in between as "–", empty ones at the
 * end left out. */
export function inlineValue(stat: ItemCardStat): string {
  const cells = [ownValue(stat), ...(stat.more ?? [])]
  while (cells.length && !cells[cells.length - 1]!.trim()) cells.pop()
  const values = cells.map((cell) => (cell.trim() ? cell : "–")).join(" · ")
  return stat.per === undefined ? values || ownValue(stat) : values ? `${values} · ${stat.per}` : stat.per
}

/** The badges, then the tags' texts: how the tags show without a picture, and in the rich layout. */
export const tagBadges = (content: TooltipContent): string[] => [...(content.badges ?? []), ...(content.artTags ?? []).map((tag) => tag.text)]

/**
 * The card with its picture paths as the page can load them. The shared tooltip takes paths in your module's bundle
 * ("dist/assets/bow.webp"); a card in the panel (ItemCard, ItemTooltip) needs an address. `root` is your module's folder
 * as the page sees it: by default the folder above the page, for a page at dist/index.html. Addresses and paths that
 * aren't in the bundle stay as they are.
 */
export function fromBundle(content: TooltipContent, root: string | URL = new URL("..", document.baseURI)): TooltipContent {
  const local = (path: string) => (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/") ? path : new URL(path, root).href)
  return {
    ...content,
    ...(content.image ? { image: local(content.image) } : {}),
    ...(content.corner?.icon ? { corner: { ...content.corner, icon: local(content.corner.icon) } } : {}),
    ...(content.icons ? { icons: content.icons.map((icon) => ({ ...icon, image: local(icon.image) })) } : {}),
    ...(content.properties ? { properties: content.properties.map((p) => (p.icon ? { ...p, icon: local(p.icon) } : p)) } : {}),
  }
}
