import { describe, expect, it } from "vitest";
import { revised } from "./elements";

describe("revised", () => {
  const element = { id: "a", version: 4, versionNonce: 1, updated: 0, locked: false };

  it("raises the version, gives a new nonce and the time, and applies the patch", () => {
    const next = revised(element, { locked: true });
    expect(next).toMatchObject({ id: "a", locked: true, version: 5 });
    expect(next.updated).toBeGreaterThan(0);
    expect(Number.isInteger(next.versionNonce)).toBe(true);
    expect(element.locked).toBe(false);
  });

  it("raises the version by more for a delete, so a restore can follow it", () => {
    expect(revised(element, {}, 2).version).toBe(6);
  });
});
