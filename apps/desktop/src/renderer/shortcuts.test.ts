import { describe, expect, it } from "vitest";
import { keyCaps, keyshortcuts, MAC, MOD, shortcutGroups } from "./shortcuts";

describe("Settings > Shortcuts", () => {
  it("lists the table's shortcuts in their groups, as key caps", () => {
    const mod = MOD();
    expect(shortcutGroups()).toEqual([
      {
        title: "General",
        rows: [
          { action: "Search workspaces, modules and settings", keys: [mod, "K"] },
          { action: "Keyboard shortcuts", keys: [mod, "/"] },
          { action: "Settings", keys: [mod, ","] },
          { action: "Home", keys: [mod, "H"] },
          { action: "Collapse or expand the rail", keys: [mod, "\\"] },
        ],
      },
      {
        title: "Workspaces",
        rows: [
          { action: "Open workspace 1 to 9 on the rail", keys: [mod, "1–9"] },
          { action: "Next tab in the panel", keys: ["Ctrl", "Tab"] },
          { action: "Previous tab in the panel", keys: ["Ctrl", "Shift", "Tab"] },
        ],
      },
      {
        title: "Browser panel",
        rows: [
          { action: "Go to the address bar", keys: [mod, "L"] },
          { action: "New tab", keys: [mod, "T"] },
          { action: "Close the tab", keys: [mod, "W"] },
          { action: "Back", keys: ["Alt", "←"] },
          { action: "Forward", keys: ["Alt", "→"] },
          { action: "Leave full screen", keys: ["Esc"] },
        ],
      },
      {
        title: "Overlays",
        rows: [
          { action: "Undo", keys: [mod, "Z"] },
          { action: "Redo", keys: [mod, "Y"] },
        ],
      },
      {
        title: "Lists and dialogs",
        rows: [
          { action: "Move through the rail", keys: ["↑", "↓"] },
          { action: "Resize the rail when its edge has focus", keys: ["←", "→"] },
          { action: "Pick the highlighted result", keys: ["Enter"] },
          { action: "Close a dialog, menu or search", keys: ["Esc"] },
        ],
      },
    ]);
  });

  it("gives buttons the platform's keys", () => {
    expect(keyCaps("search")).toEqual([MOD(), "K"]);
    expect(keyshortcuts("browser.new-tab")).toBe(MAC ? "Meta+T" : "Control+T");
    expect(keyshortcuts("layout.redo")).toBe(MAC ? "Meta+Y" : "Control+Y");
  });
});
