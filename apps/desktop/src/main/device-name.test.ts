import { describe, expect, it } from "vitest";
import { friendlyDeviceName, MAX_DEVICE_NAME } from "./device-name";

describe("a device's friendly name", () => {
  it("is the Mac's computer name when there is one", () => {
    expect(friendlyDeviceName("MacBookPro.fritz.box", " Brain MacBook Pro ")).toBe("Brain MacBook Pro");
  });

  it("drops the network part of the name", () => {
    expect(friendlyDeviceName("MacBookPro.fritz.box")).toBe("MacBookPro");
    expect(friendlyDeviceName("studio.local", "")).toBe("studio");
  });

  it("keeps a Windows name as it is", () => {
    expect(friendlyDeviceName("BRAIN-PC")).toBe("BRAIN-PC");
  });

  it("is at most so long, cut between characters as you see them", () => {
    expect(friendlyDeviceName("x", "a".repeat(10_000))).toBe("a".repeat(MAX_DEVICE_NAME));
    // 2, 8 and 4 code units each: only whole ones are kept.
    expect(friendlyDeviceName("x", "😀".repeat(200))).toBe("😀".repeat(127));
    expect(friendlyDeviceName("x", "👨‍👩‍👧".repeat(40))).toBe("👨‍👩‍👧".repeat(31));
    expect(friendlyDeviceName("x", "🇩🇪".repeat(70))).toBe("🇩🇪".repeat(63));
    expect(friendlyDeviceName("x", `Desk ${"é".repeat(300)}`)).toBe(`Desk ${"é".repeat(MAX_DEVICE_NAME - 5)}`);
    // One character longer than the limit on its own (a letter with a thousand marks): cut, but never longer.
    expect(friendlyDeviceName("x", `a${"́".repeat(1000)}`).length).toBe(MAX_DEVICE_NAME);
  });
});
