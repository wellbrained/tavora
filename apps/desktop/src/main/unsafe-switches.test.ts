import { describe, expect, it } from "vitest";
import { findUnsafeSwitch } from "./unsafe-switches";

const EXE = "C:\\Users\\user\\AppData\\Local\\Programs\\Tavora\\Tavora.exe";

describe("findUnsafeSwitch", () => {
  it("lets a plain start through", () => {
    expect(findUnsafeSwitch([EXE])).toBeUndefined();
  });

  it("lets the updater's and Windows' own arguments through", () => {
    expect(findUnsafeSwitch([EXE, "--updated", "--force-run", "--disable-lcd-text"])).toBeUndefined();
  });

  it("finds a switch in every form Chromium accepts on Windows", () => {
    expect(findUnsafeSwitch([EXE, "--remote-debugging-port=9222"])).toBe("remote-debugging-port");
    expect(findUnsafeSwitch([EXE, "-no-sandbox"])).toBe("no-sandbox");
    expect(findUnsafeSwitch([EXE, "/inspect"])).toBe("inspect");
    expect(findUnsafeSwitch([EXE, "--Disable-Web-Security"])).toBe("disable-web-security");
  });

  it("does not mistake a longer name or a value for a switch", () => {
    expect(findUnsafeSwitch([EXE, "--inspector-like"])).toBeUndefined();
    expect(findUnsafeSwitch([EXE, "tavora://game/no-sandbox"])).toBeUndefined();
  });
});
