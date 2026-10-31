import { describe, expect, it } from "vitest";
import { friendlyDeviceName } from "./device-name";

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
});
