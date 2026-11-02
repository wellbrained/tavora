import { afterEach, describe, expect, it } from "vitest";
import { keyPress, resetInputOrigin, trackInputOrigin, type OriginTarget } from "@tavora/official-ui/components/ui/sliding-indicator";
import { dialogIsInstant } from "@tavora/official-ui/components/ui/dialog";
import type { HostShortcut } from "../shared/host-api";
import { isKeyShortcut, noteShortcut } from "./shortcut-origin";

// Main sends `host:shortcut` for keys and also for clicks and module events. Only a key's makes the next dialog instant.

class FakeDocument implements OriginTarget {
  private listeners = new Map<string, Set<(event: never) => void>>();
  addEventListener(type: string, listener: (event: never) => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener);
  }
  removeEventListener(type: string, listener: (event: never) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string, event: object = {}) {
    for (const listener of this.listeners.get(type) ?? []) (listener as (event: object) => void)(event);
  }
}

describe("which shortcuts come from a key", () => {
  it("knows the ones shortcutForKey produces", () => {
    for (const shortcut of ["search", "shortcuts", "settings", "next-tab", "previous-tab", "toggle-rail", "home", "workspace-1", "workspace-9"] as HostShortcut[]) {
      expect(isKeyShortcut(shortcut), shortcut).toBe(true);
    }
  });

  it("does not take a click's or a module's for a key's", () => {
    for (const shortcut of ["panel:abc", "panels:abc:a,b", "maximize:abc", "restore:abc", "address:abc", "setting:sort"] as HostShortcut[]) {
      expect(isKeyShortcut(shortcut), shortcut).toBe(false);
    }
  });
});

describe("the next dialog after a host:shortcut", () => {
  let time = 1000;
  const now = () => time;
  afterEach(() => {
    resetInputOrigin();
    time = 1000;
  });

  it("keeps its motion after a shortcut that is not a key's (a click into a panel)", () => {
    const doc = new FakeDocument();
    const stop = trackInputOrigin(doc, now);
    doc.fire("pointerdown");
    time += 20;
    noteShortcut("panel:abc");
    time += 20;
    expect(keyPress()).toBeUndefined();
    expect(dialogIsInstant("open", false, keyPress())).toBe(false);
    stop();
  });

  it("keeps its motion after a non-key shortcut that follows an old key press", () => {
    const doc = new FakeDocument();
    const stop = trackInputOrigin(doc, now);
    doc.fire("keydown", { key: "a" });
    time += 2000;
    noteShortcut("setting:sort");
    expect(dialogIsInstant("open", false, keyPress())).toBe(false);
    stop();
  });

  it("is instant after a real shortcut", () => {
    const doc = new FakeDocument();
    const stop = trackInputOrigin(doc, now);
    doc.fire("pointerdown");
    time += 20;
    noteShortcut("settings");
    expect(dialogIsInstant("open", false, keyPress())).toBe(true);
    stop();
  });
});
