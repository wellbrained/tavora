import { TavoraError } from "./index.js";
import { LIMITS, supportsCall, type MenuEntry, type MenuRequest, type TooltipAnchor, type TooltipBlock, type TooltipContent, type TooltipEffectRun, type TooltipRequest, type TooltipSkin } from "./protocol.js";

/** What a menu or tooltip is for: an element (its box is read when you call) or a box you measured yourself. */
export type AnchorTarget = Element | { x: number; y: number; width?: number; height?: number };

/** ui.showMenu: `anchor` (an element or its box) is the way; `at` stays for the rare case without an element. One of the two. */
export type MenuOptions = Omit<MenuRequest, "at"> &
  ({ anchor: AnchorTarget; at?: undefined } | { at: MenuRequest["at"]; anchor?: undefined });

/** ui.tooltip.move: the tooltip's id, and `anchor` (an element or its box) or `at` (a point). */
export type TooltipMoveOptions = { id: string } & ({ anchor: AnchorTarget; at?: undefined; box?: undefined } | { at: TooltipAnchor["at"]; box?: TooltipAnchor["box"]; anchor?: undefined });

/** ui.tooltip.show: a tooltip request with `anchor` instead of `at`, if you like. */
export type TooltipShowOptions = Omit<TooltipRequest, "at" | "box"> & ({ anchor: AnchorTarget; at?: undefined; box?: undefined } | { at: TooltipAnchor["at"]; box?: TooltipAnchor["box"]; anchor?: undefined });

function box(target: AnchorTarget): { x: number; y: number; width: number; height: number } {
  const rect: { x: number; y: number; width?: number; height?: number } =
    typeof (target as Element).getBoundingClientRect === "function" ? (target as Element).getBoundingClientRect() : (target as { x: number; y: number });
  const { x, y, width = 0, height = 0 } = rect;
  if (![x, y, width, height].every(Number.isFinite)) throw new TavoraError({ code: "INVALID_PARAMS", message: "anchor has no box" });
  return { x, y, width, height };
}

function missing(): never {
  throw new TavoraError({ code: "INVALID_PARAMS", message: "Give an anchor (the element the menu is for) or at" });
}

/**
 * The wire form: the element's box as `at` (the host adds the gap). An older Tavora than `ui.showMenu.disabledReason`
 * refuses an item's `disabledReason`, and with it the whole menu, so there it becomes the item's hint when it has none
 * (cut to the 30 characters a hint may have) and is left out otherwise.
 */
export function menuParams(request: MenuOptions, hostVersion: string): MenuRequest {
  const { anchor, at, ...rest } = request;
  const params = supportsCall(hostVersion, "ui.showMenu.disabledReason") ? rest : { ...rest, items: withoutReasons(rest.items) };
  if (anchor) return { ...params, at: box(anchor) };
  return at ? { ...params, at } : missing();
}

/** For a Tavora without reasons on menu items: each reason becomes the hint of a switched-off item that has none. */
function withoutReasons(items: MenuEntry[]): MenuEntry[] {
  if (!Array.isArray(items)) return items;
  return items.map((entry) => {
    if (entry?.type === "submenu" && Array.isArray(entry.items)) return { ...entry, items: withoutReasons(entry.items) };
    if (entry?.type !== "item" || entry.disabledReason === undefined) return entry;
    const { disabledReason, ...item } = entry;
    return item.disabled && item.hint === undefined && typeof disabledReason === "string" && disabledReason.trim() ? { ...item, hint: cut(disabledReason.trim(), LIMITS.maxMenuHint) } : item;
  });
}

/** The tooltip's point: next to the element, at the middle of its right edge, never on top of it. */
function point(target: AnchorTarget): TooltipAnchor["at"] {
  const b = box(target);
  return { x: b.x + b.width, y: b.y + b.height / 2 };
}

/**
 * The wire form of `ui.tooltip.show`. `pinnable: false` together with `pinned: true` is a mistake in every Tavora; an
 * older Tavora than `ui.tooltip.pinnable` would reject the unknown key, so it is left out there (the card still shows,
 * with the old hint). The same goes for the card's `layout`, `effect` and `skin` on a Tavora older than
 * `ui.tooltip.skin`: the card shows in the rich layout there; and for a stat's `icon` before `ui.tooltip.propertyIcon`.
 * A stat's extra values (`more`) and their `columns` go into `per` before `ui.tooltip.columns`, and with it into the
 * value before `ui.tooltip.per`. Tags over the picture (`artTags`) become badges before `ui.tooltip.artTags`.
 * A unit card (`layout: "unit"`) becomes a plain card before `ui.tooltip.unit`, and a stat's `suffix` goes into its
 * value wherever the unit layout doesn't show it. Before `ui.tooltip.formatting`, runs lose `strong` and `italic`, and
 * `blocks` and `footer` become sections of plain rows.
 */
export function tooltipShowParams(request: TooltipShowOptions, hostVersion: string): Omit<TooltipShowOptions, "anchor" | "at"> & Pick<TooltipAnchor, "at" | "box"> {
  if (request.pinnable === false && request.pinned === true) throw new TavoraError({ code: "INVALID_PARAMS", message: "A card that is not pinnable can't be pinned" });
  const params = tooltipParams(request, hostVersion);
  if (params.pinnable !== undefined && !supportsCall(hostVersion, "ui.tooltip.pinnable")) delete params.pinnable;
  if (params.content) params.content = unitFallback(params.content, supportsCall(hostVersion, "ui.tooltip.unit"));
  if (params.content && !supportsCall(hostVersion, "ui.tooltip.formatting")) params.content = withoutFormatting(params.content);
  if (params.content && !supportsCall(hostVersion, "ui.tooltip.propertyIcon")) params.content = withoutIcons(params.content);
  if (params.content && !supportsCall(hostVersion, "ui.tooltip.columns")) params.content = withoutColumns(params.content);
  if (params.content && !supportsCall(hostVersion, "ui.tooltip.per")) params.content = withoutPer(params.content);
  if (params.content && !supportsCall(hostVersion, "ui.tooltip.artTags")) params.content = withoutArtTags(params.content);
  const content = params.content as TooltipContent | undefined;
  if (content && (content.layout !== undefined || content.effect !== undefined || content.skin !== undefined) && !supportsCall(hostVersion, "ui.tooltip.skin")) {
    const { layout: _layout, effect, skin: _skin, ...older } = content;
    params.content = effect === undefined ? older : { ...older, sections: withEffectRow(older.sections, effect) };
  }
  return params;
}

/**
 * The unit layout's own keys for a Tavora without it (`unit` false): the card layout instead, without the corner, the
 * icon row and the pips. A stat's `suffix` shows only in the unit layout; anywhere else it goes at the end of its value,
 * cut to the 300 characters a value may have.
 */
function unitFallback(content: TooltipContent, unit: boolean): TooltipContent {
  const isUnit = content.layout === "unit";
  if (unit && isUnit) return content;
  const strip = !unit && (isUnit || content.corner !== undefined || content.icons !== undefined || content.pips !== undefined);
  const suffixed = !!content.properties?.some((p) => p.suffix !== undefined);
  if (!strip && !suffixed) return content;
  const { corner: _corner, icons: _icons, pips: _pips, ...rest } = content;
  const out: TooltipContent = strip ? rest : { ...content };
  if (!unit && isUnit) out.layout = "card";
  if (suffixed) out.properties = content.properties!.map(({ suffix, ...p }) => (suffix === undefined ? p : { ...p, value: (p.value + suffix).slice(0, 300) }));
  return out;
}

type Section = NonNullable<TooltipContent["sections"]>[number];

/** The runs' text, without their emphasis. */
const runText = (runs: string | readonly TooltipEffectRun[]): string => (typeof runs === "string" ? runs : runs.map((run) => run?.text ?? "").join(""));

/**
 * For a Tavora without formatting: runs keep their text and accent, but not `strong` and `italic`; `blocks` and `footer`
 * become sections after the module's own, of plain rows (see `blockSections`), as many as Tavora takes.
 */
function withoutFormatting(content: TooltipContent): TooltipContent {
  const emphasis = Array.isArray(content.effect) && content.effect.some((run) => run?.strong !== undefined || run?.italic !== undefined);
  if (!emphasis && content.blocks === undefined && content.footer === undefined) return content;
  const { blocks, footer, ...out } = content;
  if (emphasis) out.effect = (content.effect as TooltipEffectRun[]).map((run) => (run && typeof run === "object" ? (({ strong: _strong, italic: _italic, ...rest }) => rest)(run) : run));
  const extra = [...(Array.isArray(blocks) ? blockSections(blocks) : []), ...(typeof footer === "string" || Array.isArray(footer) ? [{ rows: [{ text: runText(footer) }] }] : [])];
  // Sections that aren't a list are the module's mistake: Tavora refuses them, so nothing is added to them. A Tavora
  // without the effect box takes the effect as one more row (withEffectRow), so a row is kept free for it.
  if (!extra.length || (out.sections !== undefined && !Array.isArray(out.sections))) return out;
  return { ...out, sections: appendSections(out.sections ?? [], extra, out.effect === undefined ? 0 : 1) };
}

/**
 * The blocks as sections: a heading starts one with it as the title, and the parts after it are its rows (before the
 * first heading, in a section without one). A paragraph is one row, a list one row per line with its `meta` as the
 * status, tags one row ("Stone · Legendary"). Sections that end up without rows are left out.
 */
function blockSections(blocks: readonly TooltipBlock[]): Section[] {
  const out: Section[] = [];
  for (const block of blocks) {
    if (block?.type === "heading") {
      out.push({ title: block.text, rows: [] });
      continue;
    }
    const rows: Section["rows"] =
      block?.type === "text" ? [{ text: block.text ?? runText(block.runs ?? []) }]
      : block?.type === "list" && Array.isArray(block.items) ? block.items.map((item) => (typeof item === "string" ? { text: item } : { text: item?.text, ...(item?.meta ? { status: item.meta } : {}) }))
      : block?.type === "tags" && Array.isArray(block.tags) ? [{ text: block.tags.map((tag) => (typeof tag === "string" ? tag : tag?.text)).join(" · ") }]
      : [];
    if (!out.length) out.push({ rows: [] });
    out[out.length - 1]!.rows.push(...rows);
  }
  return out.filter((section) => section.rows.length);
}

/** The sections a tooltip may have (12), the rows of one (60) and of all (100). */
const MAX_SECTIONS = 12, MAX_SECTION_ROWS = 60, MAX_ROWS = 100;

/**
 * `extra` after `sections`, within what Tavora takes, with `keep` rows left free: when there's no room for all of
 * them, the last ones go together into one, or into the module's last section when it already has 12; rows past the
 * limits are left out.
 */
function appendSections(sections: readonly Section[], extra: Section[], keep: number): Section[] {
  let left = MAX_ROWS - keep - sections.reduce((n, section) => n + (Array.isArray(section?.rows) ? section.rows.length : 0), 0);
  const room = MAX_SECTIONS - sections.length;
  let add = extra;
  if (add.length > room) {
    const keep = add.slice(0, Math.max(0, room - 1)), folded = add.slice(keep.length);
    add = [...keep, { ...(folded[0]!.title === undefined ? {} : { title: folded[0]!.title }), rows: folded.flatMap((section) => section.rows) }];
  }
  const out = [...sections];
  for (const section of add) {
    const last = out.length >= MAX_SECTIONS ? out[out.length - 1] : undefined;
    const rows = section.rows.slice(0, Math.max(0, Math.min(left, MAX_SECTION_ROWS - (last?.rows.length ?? 0))));
    left -= rows.length;
    if (!rows.length) continue;
    if (last) out[out.length - 1] = { ...last, rows: [...last.rows, ...rows] };
    else out.push({ ...section, rows });
  }
  return out;
}

/** For a Tavora without stat icons: they go, the labels stay. */
function withoutIcons(content: TooltipContent): TooltipContent {
  if (!content.properties?.some((p) => p.icon !== undefined)) return content;
  return { ...content, properties: content.properties.map(({ icon: _icon, ...p }) => p) };
}

/** A stat's extra values as one text ("12 / 18"): an empty one in between as "–", empty ones at the end left out. */
function joinedMore(more: readonly string[] | undefined, separator: string): string {
  const cells = [...(more ?? [])];
  while (cells.length && !cells[cells.length - 1]!.trim()) cells.pop();
  return cells.map((cell) => (cell.trim() ? cell : "–")).join(separator);
}

/** `text` cut to `max` characters, ending in "…" when it was longer. */
function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * For a Tavora without extra value columns: a stat's `more` goes into its `per` ("12 / 18"), before the `per` it already
 * had ("12 / 18 · +3"), and the headings after the first become `perHeading` ("Lv 2 / Lv 3"), before the one it already
 * had; cut to the 40 and 60 characters they may have there. `columns` and `more` go.
 */
function withoutColumns(content: TooltipContent): TooltipContent {
  if (content.columns === undefined && !content.properties?.some((p) => p.more !== undefined)) return content;
  const { columns, ...rest } = content;
  if (!rest.properties) return rest;
  const folds = rest.properties.some((p) => joinedMore(p.more, "") !== "");
  const properties = rest.properties.map(({ more, ...p }) => {
    const folded = joinedMore(more, " / ");
    return folded ? { ...p, per: cut(p.per === undefined ? folded : `${folded} · ${p.per}`, 40) } : p;
  });
  const headings = (columns ?? []).slice(1).join(" / ");
  if (!folds || !headings) return { ...rest, properties };
  return { ...rest, properties, perHeading: cut(rest.perHeading === undefined ? headings : `${headings} · ${rest.perHeading}`, 60) };
}

/** As many badges as a card may have; tags that become badges past them are left out. */
const MAX_BADGES = 8;

/** For a Tavora without tags over the picture: their texts follow the badges, as many as fit, without their colours. */
function withoutArtTags(content: TooltipContent): TooltipContent {
  if (content.artTags === undefined) return content;
  const { artTags, ...rest } = content;
  const badges = [...(rest.badges ?? []), ...artTags.map((tag) => tag.text)].slice(0, Math.max(MAX_BADGES, rest.badges?.length ?? 0));
  return badges.length ? { ...rest, badges } : rest;
}

/**
 * For a Tavora without the stats' third column: each `per` goes into its value ("24 · ×1.2"), cut to the 300 characters
 * a value may have there, and the heading goes.
 */
function withoutPer(content: TooltipContent): TooltipContent {
  if (content.perHeading === undefined && !content.properties?.some((p) => p.per !== undefined)) return content;
  const { perHeading: _heading, ...rest } = content;
  if (!rest.properties) return rest;
  const folded = (value: string, per: string) => (value.trim() ? `${value} · ${per}` : per).slice(0, 300);
  return { ...rest, properties: rest.properties.map(({ per, ...p }) => (per === undefined ? p : { ...p, value: folded(p.value, per) })) };
}

/**
 * For a Tavora without the effect box: the effect as a plain row at the top of the sections, in a section of its own,
 * or as the first section's first row when there are as many sections as Tavora takes (12).
 */
function withEffectRow(sections: TooltipContent["sections"], effect: NonNullable<TooltipContent["effect"]>): NonNullable<TooltipContent["sections"]> {
  const row = { text: typeof effect === "string" ? effect : effect.map((run) => run.text).join("") };
  const list = sections ?? [];
  if (list.length < 12) return [{ rows: [row] }, ...list];
  const [first, ...rest] = list;
  return [{ ...first!, rows: [row, ...first!.rows] }, ...rest];
}

/**
 * The wire form of `ui.tooltip.defineSkin`. An older Tavora refuses a colour it doesn't know, and with it the whole
 * skin, so `colors.boxBorder` is left out before `ui.tooltip.boxBorder` (the box then has no edge there), and
 * `colors.bar` before `ui.tooltip.unit` (no unit cards there).
 */
export function skinParams(name: string, skin: TooltipSkin, hostVersion: string): { name: string; skin: TooltipSkin } {
  const dropEdge = skin.colors?.boxBorder !== undefined && !supportsCall(hostVersion, "ui.tooltip.boxBorder");
  const dropBar = skin.colors?.bar !== undefined && !supportsCall(hostVersion, "ui.tooltip.unit");
  if (!dropEdge && !dropBar) return { name, skin };
  const colors = { ...skin.colors };
  if (dropEdge) delete colors.boxBorder;
  if (dropBar) delete colors.bar;
  return { name, skin: { ...skin, colors } };
}

/**
 * The wire form of `ui.tooltip.show` and `ui.tooltip.move`: `at` next to the anchor, and the anchor's box as `box`, so
 * Tavora takes the hover anywhere over a big element, not only near `at`. An older Tavora than `ui.tooltip.anchorBox`
 * rejects the unknown key, so it is left out there (the card then shows only while the pointer is near `at`, as before).
 */
export function tooltipParams<T extends TooltipMoveOptions | TooltipShowOptions>(request: T, hostVersion: string): Omit<T, "anchor" | "at"> & Pick<TooltipAnchor, "at" | "box"> {
  const { anchor, at, box: given, ...rest } = request as T & { anchor?: AnchorTarget; at?: TooltipAnchor["at"]; box?: TooltipAnchor["box"] };
  if (!anchor && !at) missing();
  const b = anchor ? box(anchor) : given;
  const sendBox = !!b && b.width > 0 && b.height > 0 && supportsCall(hostVersion, "ui.tooltip.anchorBox");
  return { ...rest, at: anchor ? point(b!) : at, ...(sendBox ? { box: b } : {}) } as never;
}
