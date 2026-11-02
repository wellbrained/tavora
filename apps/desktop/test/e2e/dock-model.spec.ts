// The layout model (dock-model.ts) against the real dock: for many layouts and every drop target, the layout and the
// rectangles dockview ends up with must be the ones the model predicted. A bare Electron window runs both.
import { _electron as electron, expect, test } from "@playwright/test";
import { build } from "esbuild";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LayoutNode, SavedLayout } from "../../src/shared/host-api";

// The shapes the bare window's script (test/fixtures/dock-compare/entry.ts, checked with the renderer) takes.
type Side = "left" | "right" | "top" | "bottom";
type DropTarget = { kind: "split"; group: string; side: Side } | { kind: "tab"; group: string; index?: number } | { kind: "edge"; side: Side };
interface Case {
  dragged: { groupId: string; panelId: string | null };
  target: DropTarget;
}
interface Spec {
  layout: SavedLayout;
  infos: Record<string, { title: string; minWidth: number; minHeight: number }>;
  cases: Case[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../fixtures/dock-compare");
let W = 1200;
let H = 700;

type Spot = string | Spot[];
/** A layout from nested lists: a list is a split (rows and columns alternate); "a+b" is a group of tabs a and b. */
function layout(root: Spot[], direction: "row" | "column" = "row"): SavedLayout {
  const group = (spot: string, size: number): LayoutNode => ({ kind: "group", size, panels: spot.split("+"), active: spot.split("+")[0]! });
  const node = (spot: Spot, size: number, horizontal: boolean, cross: number): LayoutNode => {
    if (typeof spot === "string") return group(spot, size);
    return { kind: "split", size, children: spot.map((child) => node(child, Math.round(cross / spot.length), !horizontal, size)) };
  };
  const horizontal = direction === "row";
  const along = horizontal ? W : H;
  const across = horizontal ? H : W;
  return { width: W, height: H, direction, root: { kind: "split", size: across, children: root.map((child) => node(child, Math.round(along / root.length), !horizontal, across)) } };
}

const panelsOf = (saved: SavedLayout): string[] => {
  const walk = (n: LayoutNode): string[] => (n.kind === "group" ? n.panels : n.children.flatMap(walk));
  return walk(saved.root);
};
const groupsOf = (saved: SavedLayout): string[][] => {
  const walk = (n: LayoutNode): string[][] => (n.kind === "group" ? [n.panels] : n.children.flatMap(walk));
  return walk(saved.root);
};

/** Every drag and every target that makes sense for a layout. */
function casesFor(saved: SavedLayout): Case[] {
  const groups = groupsOf(saved);
  const ids = groups.map((_, i) => `group-${i + 1}`);
  const cases: Case[] = [];
  const sides = ["left", "right", "top", "bottom"] as const;
  groups.forEach((panels, gi) => {
    const drags = [...panels.map((panelId) => ({ groupId: ids[gi]!, panelId })), ...(panels.length > 1 || groups.length > 1 ? [{ groupId: ids[gi]!, panelId: null }] : [])];
    for (const dragged of drags) {
      const targets: DropTarget[] = [];
      for (const [ti, group] of ids.entries()) {
        for (const side of sides) targets.push({ kind: "split", group, side });
        targets.push({ kind: "tab", group });
        for (let index = 0; index <= groups[ti]!.length; index++) targets.push({ kind: "tab", group, index });
      }
      for (const side of sides) targets.push({ kind: "edge", side });
      for (const target of targets) cases.push({ dragged, target });
    }
  });
  return cases;
}

const LAYOUTS: Record<string, SavedLayout> = {
  "three columns": layout(["a", "b", "c"]),
  "two by two": layout([["a", "b"], ["c", "d"]]),
  "main and a stack": layout(["a", ["b", "c", "d"]]),
  "stack and a row": layout([["a", ["b", "c"]], "d"], "column"),
  "tabs": layout(["a+b", "c", "d+e+f"]),
  "one group": layout(["a+b"]),
  "nested": layout([["a", ["b", "c"]], ["d", "e"]]),
};
// A small window, where some drops leave a panel too little room and are refused.
W = 820;
H = 460;
LAYOUTS["small window"] = layout([["a", "b"], ["c", "d"]]);
LAYOUTS["small window, tabs"] = layout(["a+b", ["c", "d+e"]]);
W = 1200;
H = 700;

function infos(saved: SavedLayout): Spec["infos"] {
  return Object.fromEntries(panelsOf(saved).map((id) => [id, { title: id, minWidth: 262, minHeight: 142 }]));
}

test.describe("the layout model matches dockview", () => {
  test.setTimeout(240_000);
  for (const [name, saved] of Object.entries(LAYOUTS)) {
    test(name, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "tavora-dock-compare-"));
      await build({ entryPoints: [path.join(fixture, "entry.ts")], bundle: true, outfile: path.join(dir, "entry.js"), loader: { ".css": "css" }, logLevel: "silent", conditions: ["source"] });
      await cp(path.join(fixture, "page.html"), path.join(dir, "page.html"));
      const delegate = process.env.ELECTRON_RUN_AS_NODE;
      delete process.env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({ args: [fixture], env: { ...process.env, DOCK_COMPARE_DIR: dir } });
      if (delegate) process.env.ELECTRON_RUN_AS_NODE = delegate;
      try {
        const page = await app.firstWindow();
        await page.waitForFunction(() => typeof (window as never as { compare?: unknown }).compare === "function");
        const spec: Spec = { layout: saved, infos: infos(saved), cases: casesFor(saved) };
        if (process.env.DOCK_DUMP) console.log(JSON.stringify(await page.evaluate((input) => (window as never as { dump: (spec: Spec) => unknown }).dump(input), spec)));
        const reports = await page.evaluate((input) => (window as never as { compare: (spec: Spec) => unknown[] }).compare(input), spec);
        type Report = { case: Case; outcome: string; detail?: string; reason?: string };
        const bad = (reports as Report[]).filter((report) => report.outcome === "mismatch");
        const summary = (reports as Report[]).reduce<Record<string, number>>((all, report) => ({ ...all, [report.outcome]: (all[report.outcome] ?? 0) + 1 }), {});
        console.log(name, JSON.stringify(summary));
        expect(bad.slice(0, 8).map((report) => `${JSON.stringify(report.case)} ${report.detail}`)).toEqual([]);
      } finally {
        await app.close();
      }
    });
  }
});
