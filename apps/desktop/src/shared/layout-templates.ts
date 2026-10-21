// Layout templates: common arrangements of empty slots to start a workspace
// from. Shared, so the host UI can list them and the main process can build
// them; it must not import Electron or Node.

/**
 * One child of a template's root: a slot of that relative size, or a split
 * of slots (running the other way) with these relative sizes. The split's own
 * size is the sum of its slots'.
 */
export type TemplatePart = number | readonly number[];

export interface LayoutTemplate {
  id: string;
  name: string;
  /** "row" places the root's parts side by side, "column" stacks them. */
  direction: "row" | "column";
  parts: readonly TemplatePart[];
}

/** Uneven arrangements; even grids come from the grid picker (gridTemplate). */
export const LAYOUT_TEMPLATES = [
  { id: "main-sidebar", name: "Main + side", direction: "row", parts: [2, 1] },
  { id: "sidebar-main", name: "Side + main", direction: "row", parts: [1, 2] },
  { id: "main-stacked", name: "Main + 2 stacked", direction: "row", parts: [3, [1, 1]] },
  { id: "stacked-main", name: "2 stacked + main", direction: "row", parts: [[1, 1], 3] },
  { id: "top-two", name: "Top + 2 below", direction: "column", parts: [2, [1, 1]] },
  { id: "two-bottom", name: "2 on top + bottom", direction: "column", parts: [[1, 1], 2] },
] as const satisfies readonly LayoutTemplate[];

export type LayoutTemplateId = (typeof LAYOUT_TEMPLATES)[number]["id"];

/**
 * The most columns and rows a grid can have. Beyond this, panels get too
 * small for most modules even on a large screen.
 */
export const GRID_LIMITS = { columns: 5, rows: 4 } as const;

/** "3 × 2 grid", or "3 columns" and "2 rows" when there is only one of the other. */
export function gridName(columns: number, rows: number): string {
  if (rows === 1) return columns === 1 ? "1 slot" : `${columns} columns`;
  if (columns === 1) return `${rows} rows`;
  return `${columns} × ${rows} grid`;
}

/** An even grid of `columns` by `rows` slots. */
export function gridTemplate(columns: number, rows: number): LayoutTemplate {
  const base = { id: `grid-${columns}x${rows}`, name: gridName(columns, rows) };
  if (rows === 1) return { ...base, direction: "row", parts: Array<number>(columns).fill(1) };
  if (columns === 1) return { ...base, direction: "column", parts: Array<number>(rows).fill(1) };
  return { ...base, direction: "row", parts: Array.from({ length: columns }, () => Array<number>(rows).fill(1)) };
}

export function layoutTemplate(id: string) {
  return LAYOUT_TEMPLATES.find((template) => template.id === id);
}

/** A part's share of its template, relative to the other parts. */
export const templateWeight = (part: TemplatePart): number => (typeof part === "number" ? part : part.reduce<number>((sum, value) => sum + value, 0));

/** Where a template's slots are, as fractions (0 to 1) of the area it fills; for previews. */
export function templateRects(template: LayoutTemplate): { x: number; y: number; width: number; height: number }[] {
  const row = template.direction === "row";
  const total = template.parts.reduce<number>((sum, part) => sum + templateWeight(part), 0);
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  let along = 0;
  for (const part of template.parts) {
    const share = templateWeight(part) / total;
    const slots = typeof part === "number" ? [1] : part;
    const sum = slots.reduce((acc, value) => acc + value, 0);
    let across = 0;
    for (const value of slots) {
      const size = value / sum;
      rects.push(row ? { x: along, y: across, width: share, height: size } : { x: across, y: along, width: size, height: share });
      across += size;
    }
    along += share;
  }
  return rects;
}
