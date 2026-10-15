import { describe, expect, it } from "vitest";
import { contentFromText, matches, normalizeLink, parseNote, previewFor, relativeTime, sections, titleFor, type NoteEntry } from "./notes";

function entry(id: string, patch: Partial<NoteEntry> = {}): NoteEntry {
  return { id, title: id, text: "", pinned: false, updatedAt: "2026-10-14T10:00:00.000Z", revision: 1, ...patch };
}

describe("parseNote", () => {
  it("fills in a missing or damaged note", () => {
    expect(parseNote(null, "T")).toEqual({
      version: 1,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      text: "",
      pinned: false,
      createdAt: "T",
    });
    expect(parseNote({ content: "nope", text: 4, pinned: "yes" }, "T").pinned).toBe(false);
    expect(parseNote([1, 2] as never, "T").text).toBe("");
  });

  it("keeps valid fields", () => {
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] };
    expect(parseNote({ content, text: "Hi", pinned: true, createdAt: "C" })).toMatchObject({ content, text: "Hi", pinned: true, createdAt: "C" });
  });
});

describe("contentFromText", () => {
  it("makes one paragraph per line, empty lines included", () => {
    expect(contentFromText("a\n\nb")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    });
    expect(contentFromText("").content).toEqual([{ type: "paragraph" }]);
  });
});

describe("titleFor", () => {
  it("uses the first non-empty line without Markdown markers", () => {
    expect(titleFor("a", "\n  Count Geonor  \nPhase two")).toBe("Count Geonor");
    expect(titleFor("a", "## Boss plan")).toBe("Boss plan");
    expect(titleFor("a", "- [ ] buy flasks")).toBe("[ ] buy flasks");
    expect(titleFor("a", "[x] done thing")).toBe("done thing");
    expect(titleFor("a", "")).toBe("Untitled note");
  });

  it("names the scratchpad Scratchpad and shortens long lines", () => {
    expect(titleFor("scratchpad", "Anything")).toBe("Scratchpad");
    const title = titleFor("a", "x".repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("previewFor", () => {
  it("skips the title line, except for the scratchpad", () => {
    expect(previewFor({ id: "a", text: "Title\nfirst\n\nsecond" })).toBe("first second");
    expect(previewFor({ id: "scratchpad", text: "one\ntwo" })).toBe("one two");
  });
});

describe("matches", () => {
  it("needs every word, in any order and case", () => {
    const note = { title: "Count Geonor", text: "Use FIRE resistance" };
    expect(matches(note, "fire count")).toBe(true);
    expect(matches(note, "fire ice")).toBe(false);
    expect(matches(note, "   ")).toBe(true);
  });
});

describe("sections", () => {
  it("puts the scratchpad first, then pinned and other notes newest first", () => {
    const result = sections([
      entry("old", { updatedAt: "2026-10-01T00:00:00.000Z" }),
      entry("pin", { pinned: true }),
      entry("new", { updatedAt: "2026-10-14T12:00:00.000Z" }),
      entry("scratchpad", { text: "x" }),
    ]);
    expect(result.scratchpad.text).toBe("x");
    expect(result.pinned.map((note) => note.id)).toEqual(["pin"]);
    expect(result.others.map((note) => note.id)).toEqual(["new", "old"]);
  });

  it("always has a scratchpad, saved or not", () => {
    expect(sections([]).scratchpad).toMatchObject({ id: "scratchpad", title: "Scratchpad", revision: 0 });
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-14T12:00:00");
  it("reads naturally", () => {
    expect(relativeTime(new Date(now - 20_000).toISOString(), now)).toBe("Just now");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5 min ago");
    expect(relativeTime(new Date(now - 26 * 3_600_000).toISOString(), now)).toBe("Yesterday");
    expect(relativeTime("garbage", now)).toBe("");
  });
});

describe("normalizeLink", () => {
  it("accepts web and mail links and adds https when missing", () => {
    expect(normalizeLink("poe2db.tw/us")).toBe("https://poe2db.tw/us");
    expect(normalizeLink("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("file:///etc/passwd")).toBeNull();
    expect(normalizeLink("  ")).toBeNull();
  });
});
