import { describe, expect, it } from "vitest";
import { fromDockview, toDockview } from "./dock";
import { outerColumns } from "./dock-columns";
import { gridTemplate, layoutTemplate } from "../shared/layout-templates";
import { templateLayout } from "../main/layout";

const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
const info = () => ({ title: "Panel", minWidth: 100, minHeight: 100 });

describe("outerColumns", () => {
  it("includes every stacked group in an outer column", () => {
    const json = toDockview(templateLayout(layoutTemplate("main-stacked")!, ids), info);
    expect(outerColumns(json)).toEqual([
      { side: "left", groups: ["group-1"], panels: [ids[0]], width: 720, hidden: false, canCollapse: true },
      { side: "right", groups: ["group-2", "group-3"], panels: [ids[1], ids[2]], width: 480, hidden: false, canCollapse: true },
    ]);
  });

  it("keeps at least one column open", () => {
    const layout = templateLayout(gridTemplate(2, 1), ids);
    layout.root.children[0]!.hidden = true;
    const columns = outerColumns(toDockview(layout, info));
    expect(columns.map((column) => column.hidden)).toEqual([true, false]);
    expect(columns.every((column) => !column.canCollapse)).toBe(true);
  });

  it("does not treat a half-height split as a full-height column", () => {
    expect(outerColumns(toDockview(templateLayout(layoutTemplate("top-two")!, ids), info))).toEqual([]);
    expect(outerColumns(toDockview(templateLayout(gridTemplate(1, 3), ids), info))).toEqual([]);
    expect(outerColumns(toDockview(templateLayout(gridTemplate(1, 1), ids), info))).toEqual([]);
  });

  it("round-trips hidden columns, their widths, and their stacked children", () => {
    const layout = templateLayout(layoutTemplate("main-stacked")!, ids);
    const right = layout.root.children[1]!;
    right.hidden = true;
    if (right.kind === "split") right.children.forEach((child) => child.hidden = true);
    expect(fromDockview(toDockview(layout, info))).toEqual(layout);
  });
});
