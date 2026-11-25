// Bug hunt D (2026-11-25) L6 (P8): a module folder named like a command is packed.
import { describe, expect, it } from "vitest";
import { commandOf } from "./command.ts";

describe("commandOf", () => {
  it("reads a command with its argument", () => {
    expect(commandOf(["link", "ABC-123"], () => true)).toBe("link");
    expect(commandOf(["publish", "a.zip"], () => false)).toBe("publish");
    expect(commandOf(["withdraw", "a.zip"], () => false)).toBe("withdraw");
    expect(commandOf(["key", "new.key"], () => false)).toBe("key");
  });

  it("packs a module folder named like a command", () => {
    for (const name of ["link", "publish", "withdraw", "key"]) expect(commandOf([name], (folder) => folder === name)).toBeNull();
    expect(commandOf(["my-module"], () => true)).toBeNull();
  });

  it("keeps a command that misses its argument a command, so it shows the usage", () => {
    expect(commandOf(["link"], () => false)).toBe("link");
  });
});
