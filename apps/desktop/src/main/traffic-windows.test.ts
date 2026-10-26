import { describe, expect, it } from "vitest";
import { dateTime, guidBytes } from "./traffic-windows";

describe("traffic-windows", () => {
  it("writes a GUID the way Windows lays it out", () => {
    expect(guidBytes("00000036-0000-0000-c000-000000000046").toString("hex")).toBe("3600000000000000c000000000000046");
    expect(guidBytes("5074f851-950d-4165-9c15-365619481eea").toString("hex")).toBe("51f874500d9565419c15365619481eea");
  });

  it("turns a time into Windows' 100-nanosecond steps since 1601", () => {
    expect(dateTime(0)).toBe(116444736000000000n);
    expect(dateTime(Date.UTC(2026, 9, 26))).toBe(BigInt(Date.UTC(2026, 9, 26)) * 10000n + 116444736000000000n);
  });
});
