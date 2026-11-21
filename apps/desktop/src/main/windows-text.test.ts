import { describe, expect, it, vi } from "vitest";
import { decodeConsoleText, type ToWide } from "./windows-text";

/** Code page 850's bytes for the letters these tests use, as Windows would turn them into text. */
const CP850: Record<number, string> = { 0x81: "ü", 0x84: "ä", 0x94: "ö", 0xe1: "ß" };
const page850: ToWide = (_page, _flags, bytes, count, wide) => {
  for (let i = 0; i < count; i += 1) wide[i] = (CP850[bytes[i]!] ?? String.fromCharCode(bytes[i]!)).charCodeAt(0);
  return count;
};

describe("decodeConsoleText", () => {
  it("reads umlauts as the PC's code page writes them", () => {
    const toWide = vi.fn(page850);
    const name = Buffer.from([0x4d, 0x81, 0x6c, 0x6c, 0x20, 0x53, 0x74, 0x72, 0x61, 0xe1, 0x65]);
    expect(decodeConsoleText(name, toWide)).toBe("Müll Straße");
    // CP_OEMCP: the page of this PC, whichever it is.
    expect(toWide.mock.calls[0]![0]).toBe(1);
  });

  it("doesn't ask Windows for plain ASCII", () => {
    const toWide = vi.fn(page850);
    expect(decodeConsoleText(Buffer.from("C:\\Games\\Elden Ring"), toWide)).toBe("C:\\Games\\Elden Ring");
    expect(toWide).not.toHaveBeenCalled();
  });

  it("falls back to UTF-8 when Windows can't be asked", () => {
    const failing: ToWide = () => {
      throw new Error("no kernel32");
    };
    expect(decodeConsoleText(Buffer.from("Müller", "utf8"), failing)).toBe("Müller");
    expect(decodeConsoleText(Buffer.from("Müller", "utf8"), () => 0)).toBe("Müller");
  });
});
