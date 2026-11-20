import { describe, expect, it } from "vitest";
import { isSafeEntryName } from "./zip";

describe("isSafeEntryName", () => {
  it("refuses a part Windows keeps for a device, also with an extension, a superscript digit or as CONIN$", () => {
    for (const name of ["COM1.x", "dist/NUL.a", "con.txt", "assets/COM¹", "CONIN$", "conout$/a.js", "lpt³.png"]) expect(isSafeEntryName(name), name).toBe(false);
  });

  it("lets through names that only start like one", () => {
    for (const name of ["dist/console.js", "COM10.txt", "assets/nullify.png"]) expect(isSafeEntryName(name), name).toBe(true);
  });
});
