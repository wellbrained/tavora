import { describe, expect, it } from "vitest";
import { ariaKeys, isAppShortcut, shortcutClashes, shortcutForKey, shortcutIn, SHORTCUTS, type ShortcutSpec } from "./shortcuts";

const press = (key: string, held: Partial<Record<"control" | "meta" | "alt" | "shift", boolean>> = {}) => ({ type: "keyDown", key, control: false, meta: false, alt: false, shift: false, ...held });

describe("the shortcut table", () => {
  it("has no two shortcuts on one key, on Windows or on a Mac", () => {
    expect(shortcutClashes(SHORTCUTS, false)).toEqual([]);
    expect(shortcutClashes(SHORTCUTS, true)).toEqual([]);
  });

  it("would say so if two did", () => {
    const clash: ShortcutSpec[] = [
      { id: "search", keys: "Mod+K", scope: "app", group: "general", label: "shortcuts.search" },
      { id: "browser.kill", keys: "Mod+K", scope: "browser", group: "browser", label: "shortcuts.closeTab" },
      // The same key in two scopes that are never on together is fine.
      { id: "browser.esc", keys: "Escape", scope: "browser", group: "browser", label: "shortcuts.leaveFullscreen" },
      { id: "list.esc", keys: "Escape", scope: "list", group: "lists", label: "shortcuts.closeDialog" },
      // A loose Shift takes the shifted press too.
      { id: "layout.a", keys: "Mod+/", scope: "layout", group: "overlays", label: "overlays.layout.undo", loose: ["Shift"] },
      { id: "layout.b", keys: "Mod+Shift+/", scope: "layout", group: "overlays", label: "overlays.layout.redo" },
      // A numbered one takes every digit.
      { id: "workspace", keys: "Mod+1-9", scope: "app", group: "general", label: "shortcuts.openWorkspace" },
      { id: "list.five", keys: "Control+5", scope: "list", group: "lists", label: "shortcuts.pick" },
    ];
    expect(shortcutClashes(clash, false)).toEqual([
      "search and browser.kill both take control:k",
      "layout.a and layout.b both take control+shift:/",
      "workspace and list.five both take control:5",
    ]);
    expect(shortcutClashes(clash, true)).toEqual(["search and browser.kill both take meta:k on a Mac", "layout.a and layout.b both take meta+shift:/ on a Mac"]);
  });

  it("has one entry per id", () => {
    const ids = SHORTCUTS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves the keys editors use to the panel", () => {
    // Main catches Tavora-wide shortcuts before any page sees the key, so these would never reach a module's editor.
    for (const mac of [false, true]) {
      for (const key of ["a", "b", "c", "i", "u", "v", "x", "y", "z", "s", "f", "Enter", "Backspace"]) {
        expect(shortcutForKey(press(key, mac ? { meta: true } : { control: true }), mac), key).toBeNull();
        expect(shortcutForKey(press(key, mac ? { meta: true, shift: true } : { control: true, shift: true }), mac), key).toBeNull();
      }
    }
  });
});

describe("browser panel keys", () => {
  it("use Tavora's modifier, the other one may be held too", () => {
    expect(shortcutIn("browser", press("l", { control: true }), false)).toBe("browser.address");
    expect(shortcutIn("browser", press("T", { control: true, meta: true }), false)).toBe("browser.new-tab");
    expect(shortcutIn("browser", press("w", { meta: true }), true)).toBe("browser.close-tab");
    expect(shortcutIn("browser", press("w", { meta: true }), false)).toBeNull();
    expect(shortcutIn("browser", press("t", { control: true, shift: true }), false)).toBeNull();
  });

  it("go back and forward with Alt and an arrow, Shift or not, never with Tavora's modifier", () => {
    expect(shortcutIn("browser", press("ArrowLeft", { alt: true }), false)).toBe("browser.back");
    expect(shortcutIn("browser", press("ArrowRight", { alt: true, shift: true }), true)).toBe("browser.forward");
    expect(shortcutIn("browser", press("ArrowLeft", { alt: true, control: true }), false)).toBeNull();
    expect(shortcutIn("browser", press("ArrowLeft", { alt: true, control: true }), true)).toBe("browser.back");
  });

  it("take Esc with anything held, and ignore key releases", () => {
    expect(shortcutIn("browser", press("Escape", { control: true, shift: true }), false)).toBe("browser.leave-fullscreen");
    expect(shortcutIn("browser", { ...press("Escape"), type: "keyUp" }, false)).toBeNull();
  });
});

describe("aria-keyshortcuts", () => {
  it("names the platform's modifier", () => {
    expect(ariaKeys("search", false)).toBe("Control+K");
    expect(ariaKeys("search", true)).toBe("Meta+K");
    expect(ariaKeys("next-tab", true)).toBe("Control+Tab");
    expect(ariaKeys("browser.back", false)).toBe("Alt+ArrowLeft");
  });

  it("lists every digit and every alternative", () => {
    expect(ariaKeys("workspace", false)).toBe("Control+1 Control+2 Control+3 Control+4 Control+5 Control+6 Control+7 Control+8 Control+9");
    expect(ariaKeys("list.move", false)).toBe("ArrowUp ArrowDown");
  });
});

describe("isAppShortcut", () => {
  it("knows the Tavora-wide ones, numbered ones by their digit", () => {
    expect(isAppShortcut("search")).toBe(true);
    expect(isAppShortcut("workspace-9")).toBe(true);
    expect(isAppShortcut("workspace-10")).toBe(false);
    expect(isAppShortcut("browser.new-tab")).toBe(false);
    expect(isAppShortcut("panel:abc")).toBe(false);
  });
});
