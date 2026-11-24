import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript test server for update-check.mjs
import { byteRange } from "./serve-feed.mjs";

describe("serve-feed byteRange", () => {
  it("serves the whole file without a Range header, and a range as asked", () => {
    expect(byteRange(undefined, 100)).toEqual({ start: 0, end: 99, partial: false });
    expect(byteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19, partial: true });
    expect(byteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99, partial: true });
    expect(byteRange("bytes=95-", 100)).toEqual({ start: 95, end: 99, partial: true });
  });

  it("serves the last bytes for a suffix range, as electron-updater may ask", () => {
    expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99, partial: true });
    expect(byteRange("bytes=-500", 100)).toEqual({ start: 0, end: 99, partial: true });
  });

  it("refuses a range it can't serve (416) and serves all of it for one it doesn't read", () => {
    expect(byteRange("bytes=100-", 100)).toBeNull();
    expect(byteRange("bytes=20-10", 100)).toBeNull();
    expect(byteRange("bytes=-0", 100)).toBeNull();
    expect(byteRange("bytes=-", 100)).toEqual({ start: 0, end: 99, partial: false });
    expect(byteRange("bytes=0-1, 5-6", 100)).toEqual({ start: 0, end: 99, partial: false });
  });
});
