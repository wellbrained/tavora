// A drop on the dock edge adds a group for the panel; when the panel closed during the drag nothing is added, so no empty
// group is left behind.
import { describe, expect, it, vi } from "vitest";
import type { DockviewApi } from "dockview-vue";
import { applyDrop } from "./dock-drop";

function fakeApi(panelThere: boolean) {
  const moveTo = vi.fn();
  const addGroup = vi.fn(() => ({ id: "new" }));
  const api = {
    getGroup: (id: string) => (id === "g1" ? { api: { moveTo } } : undefined),
    getPanel: (id: string) => (panelThere && id === "p1" ? { api: { moveTo } } : undefined),
    addGroup,
  };
  return { api: api as unknown as DockviewApi, addGroup, moveTo };
}

describe("applyDrop", () => {
  const dragged = { groupId: "g1", panelId: "p1" } as never;
  const edge = { kind: "edge", side: "left" } as never;

  it("moves the panel into a group added at the edge", () => {
    const { api, addGroup, moveTo } = fakeApi(true);
    expect(applyDrop(api, dragged, edge)).toBe(true);
    expect(addGroup).toHaveBeenCalledTimes(1);
    expect(moveTo).toHaveBeenCalledTimes(1);
  });

  it("adds no group when the panel is gone", () => {
    const { api, addGroup } = fakeApi(false);
    expect(applyDrop(api, dragged, edge)).toBe(false);
    expect(addGroup).not.toHaveBeenCalled();
  });
});
