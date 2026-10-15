import { describe, expect, it } from "vitest";
import { gridTemplate, layoutTemplate } from "../shared/layout-templates";
import { layoutPanels, parseLayout, pruneLayout, templateLayout, type LayoutNode, type SavedLayout } from "./layout";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const D = "00000000-0000-4000-8000-00000000000d";

const group = (size: number, ...panels: string[]): LayoutNode => ({ kind: "group", size, panels, active: panels[0]! });
const split = (size: number, ...children: LayoutNode[]): LayoutNode => ({ kind: "split", size, children });
const layout = (...children: LayoutNode[]): SavedLayout => ({
  width: 1000,
  height: 600,
  direction: "row",
  root: { kind: "split", size: 600, children },
});

// A | (B over C+D)
const sample = layout(group(400, A), split(600, group(300, B), group(300, C, D)));

describe("parseLayout", () => {
  it("accepts a layout and returns a copy", () => {
    const parsed = parseLayout(JSON.parse(JSON.stringify(sample)));
    expect(parsed).toEqual(sample);
    expect(layoutPanels(parsed)).toEqual([A, B, C, D]);
  });

  it.each([
    ["an unknown key", { ...sample, extra: 1 }],
    ["a bad direction", { ...sample, direction: "diagonal" }],
    ["a group at the root", { ...sample, root: group(600, A) }],
    ["a panel twice", layout(group(500, A), group(500, A))],
    ["a bad panel id", layout(group(500, "../x"))],
    ["an empty slot with an active panel", layout({ kind: "group", size: 1, panels: [], active: A })],
    ["an active panel that is not in the group", layout({ kind: "group", size: 1, panels: [A], active: B })],
    ["a negative size", layout(group(-1, A))],
    ["an endless size", { ...sample, width: Number.POSITIVE_INFINITY }],
    ["a node with extra keys", layout({ ...group(1, A), title: "x" } as unknown as LayoutNode)],
  ])("rejects %s", (_name, raw) => {
    expect(parseLayout(raw)).toBeNull();
  });

  it("rejects layouts nested too deeply", () => {
    let node: LayoutNode = group(1, A);
    for (let i = 0; i < 20; i++) node = split(1, node, group(1, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    expect(parseLayout(layout(node))).toBeNull();
  });
});

describe("empty slots", () => {
  const slot = (size: number): LayoutNode => ({ kind: "group", size, panels: [], active: null });

  it("are accepted", () => {
    const raw = layout(group(500, A), slot(500));
    expect(parseLayout(JSON.parse(JSON.stringify(raw)))).toEqual(raw);
  });

  it("stay when panels are pruned, while groups emptied by pruning go", () => {
    const pruned = pruneLayout(layout(group(400, A), slot(300), group(300, B)), (id) => id !== B);
    expect(pruned).toEqual(layout(group(400, A), slot(300)));
    expect(pruneLayout(layout(slot(500), slot(500)), () => false)).toEqual(layout(slot(500), slot(500)));
  });
});

describe("templateLayout", () => {
  it("builds empty slots in the template's shape", () => {
    const built = templateLayout(layoutTemplate("main-stacked")!, []);
    expect(built.direction).toBe("row");
    expect(built.root.children).toEqual([
      { kind: "group", size: 720, panels: [], active: null },
      {
        kind: "split",
        size: 480,
        children: [
          { kind: "group", size: 400, panels: [], active: null },
          { kind: "group", size: 400, panels: [], active: null },
        ],
      },
    ]);
    expect(parseLayout(built)).toEqual(built);
  });

  it("fills slots in order with the open panels, extras as tabs in the last", () => {
    const built = templateLayout(gridTemplate(2, 1), [A, B, C]);
    expect(built.root.children).toEqual([
      { kind: "group", size: 600, panels: [A], active: A },
      { kind: "group", size: 600, panels: [B, C], active: B },
    ]);
    for (const [columns, rows] of [[2, 2], [5, 4], [1, 3], [1, 1]] as const) {
      const grid = templateLayout(gridTemplate(columns, rows), [A]);
      expect(layoutPanels(grid)).toEqual([A]);
      expect(parseLayout(grid)).toEqual(grid);
    }
  });
});

describe("pruneLayout", () => {
  it("keeps everything when every panel stays", () => {
    expect(pruneLayout(sample, () => true)).toEqual(sample);
  });

  it("removes a panel from its group and picks another active tab", () => {
    const pruned = pruneLayout(sample, (id) => id !== C)!;
    expect(pruned.root.children[1]).toEqual(split(600, group(300, B), group(300, D)));
  });

  it("lets a lone group take the place of its split", () => {
    const pruned = pruneLayout(sample, (id) => id !== B)!;
    expect(pruned.root.children).toEqual([group(400, A), { ...group(600, C, D) }]);
  });

  it("merges a lone split into its parent, which runs the same way", () => {
    // A | (B over (C | D)); dropping B leaves C | D inside the row.
    const nested = layout(group(400, A), split(600, group(300, B), split(300, group(200, C), group(400, D))));
    const pruned = pruneLayout(nested, (id) => id !== B)!;
    expect(pruned.root.children).toEqual([group(400, A), group(200, C), group(400, D)]);
  });

  it("turns the root when only one of its splits is left", () => {
    const pruned = pruneLayout(sample, (id) => id !== A)!;
    expect(pruned.direction).toBe("column");
    expect(pruned.root.children).toEqual([group(300, B), group(300, C, D)]);
  });

  it("returns null when no panel is left, and renames panels", () => {
    expect(pruneLayout(sample, () => false)).toBeNull();
    expect(pruneLayout(null, () => true)).toBeNull();
    const renamed = pruneLayout(sample, () => true, (id) => (id === A ? D : id === D ? A : id));
    expect(layoutPanels(renamed)).toEqual([D, B, C, A]);
  });
});
