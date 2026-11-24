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

  it("is at most so many characters, without splitting one", () => {
    expect(friendlyDeviceName("x", "a".repeat(10_000))).toBe("a".repeat(MAX_DEVICE_NAME));
    const emoji = friendlyDeviceName("x", "😀".repeat(MAX_DEVICE_NAME + 1));
    expect([...emoji]).toHaveLength(MAX_DEVICE_NAME);
    expect(emoji).toBe("😀".repeat(MAX_DEVICE_NAME));
  });
});
