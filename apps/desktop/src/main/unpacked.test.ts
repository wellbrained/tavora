import { describe, expect, it } from "vitest";
import { unpackedPath } from "./unpacked";

describe("unpackedPath", () => {
  it("points a file in app.asar to app.asar.unpacked", () => {
    expect(unpackedPath("C:\\Users\\me\\AppData\\Local\\Programs\\Tavora\\resources\\app.asar\\out\\main\\system-info-worker.cjs")).toBe(
      "C:\\Users\\me\\AppData\\Local\\Programs\\Tavora\\resources\\app.asar.unpacked\\out\\main\\system-info-worker.cjs",
    );
    expect(unpackedPath("/opt/Tavora/resources/app.asar/out/main/system-info-worker.cjs")).toBe("/opt/Tavora/resources/app.asar.unpacked/out/main/system-info-worker.cjs");
  });

  it("leaves a development path and an unpacked path alone", () => {
    expect(unpackedPath("D:\\Github\\Tavora\\apps\\desktop\\out\\main\\system-info-worker.cjs")).toBe("D:\\Github\\Tavora\\apps\\desktop\\out\\main\\system-info-worker.cjs");
    expect(unpackedPath("/r/app.asar.unpacked/out/main/w.cjs")).toBe("/r/app.asar.unpacked/out/main/w.cjs");
  });
});
