import { describe, expect, it } from "vitest";
import { cleanTitle, contentFromText, fontStack, matches, normalizeLink, nudged, parseAppearance, parseNote, parseOrder, reordered, previewFor, relativeTime, sections, titleFor, type NoteEntry } from "./notes";

function entry(id: string, patch: Partial<NoteEntry> = {}): NoteEntry {
  return { id, title: id, text: "", fixedTitle: "", pinned: false, createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "2026-10-14T10:00:00.000Z", revision: 1, ...patch };
}

describe("parseNote", () => {
  it("fills in a missing or damaged note", () => {
    expect(parseNote(null, "T")).toEqual({
      version: 1,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      text: "",
      title: "",
      pinned: false,
      createdAt: "T",
    });
    expect(parseNote({ content: "nope", text: 4, pinned: "yes" }, "T").pinned).toBe(false);
    expect(parseNote([1, 2] as never, "T").text).toBe("");
    expect(parseNote({ title: 4 }, "T").title).toBe("");
  });

  it("reads a title set by hand and tidies it", () => {
    expect(parseNote({ title: "  Boss \n plan " }, "T").title).toBe("Boss plan");
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

describe("cleanTitle", () => {
  it("makes one trimmed line and caps the length", () => {
    expect(cleanTitle("  a \n\t b  ")).toBe("a b");
    expect(cleanTitle("   ")).toBe("");
    expect(cleanTitle("x".repeat(300))).toHaveLength(120);
  });
});

describe("titleFor", () => {
  it("prefers a title set by hand to the first line", () => {
    expect(titleFor("a", "First line\nmore", "Boss plan")).toBe("Boss plan");
    expect(titleFor("a", "First line", "")).toBe("First line");
    expect(titleFor("scratchpad", "x", "Mine")).toBe("Scratchpad");
  });

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
    expect(previewFor({ id: "a", text: "Title\nfirst\n\nsecond", fixedTitle: "" })).toBe("first second");
    expect(previewFor({ id: "scratchpad", text: "one\ntwo", fixedTitle: "" })).toBe("one two");
    expect(previewFor({ id: "a", text: "Title\nfirst", fixedTitle: "Mine" })).toBe("Title first");
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
  it("puts the scratchpad first, then pinned and other notes in the order they were made", () => {
    const result = sections([
      entry("new", { createdAt: "2026-10-14T12:00:00.000Z" }),
      entry("pin", { pinned: true }),
      entry("old", { createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" }),
      entry("scratchpad", { text: "x" }),
    ]);
    expect(result.scratchpad.text).toBe("x");
    expect(result.pinned.map((note) => note.id)).toEqual(["pin"]);
    // A note edited later stays where it was; a new note comes last.
    expect(result.others.map((note) => note.id)).toEqual(["old", "new"]);
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

describe("parseAppearance", () => {
  it("gives every part a valid font and size, with defaults for anything unknown", () => {
    expect(parseAppearance(null)).toEqual({
      notes: { font: "inter", size: "medium" },
      scratchpad: { font: "inter", size: "medium" },
    });
    expect(parseAppearance({ notes: { font: "lora", size: "large" }, scratchpad: { font: "comic", size: 4 } })).toEqual({
      notes: { font: "lora", size: "large" },
      scratchpad: { font: "inter", size: "medium" },
    });
    expect(parseAppearance([1] as never).notes.font).toBe("inter");
  });

  it("finds the CSS stack of a font", () => {
    expect(fontStack("lora")).toContain("Lora Variable");
  });
});

describe("a hand-made order", () => {
  const notes = [
    entry("a", { createdAt: "2026-10-01T00:00:00.000Z" }),
    entry("b", { createdAt: "2026-10-02T00:00:00.000Z" }),
    entry("c", { createdAt: "2026-10-03T00:00:00.000Z" }),
    entry("p", { pinned: true, createdAt: "2026-10-04T00:00:00.000Z" }),
    entry("q", { pinned: true, createdAt: "2026-10-05T00:00:00.000Z" }),
  ];
  const ids = (list: NoteEntry[]) => list.map((note) => note.id);

  it("puts ordered notes first, then the rest by age, so a new note comes last", () => {
    expect(ids(sections(notes, ["c", "a"]).others)).toEqual(["c", "a", "b"]);
    expect(ids(sections(notes, ["gone", "b"]).others)).toEqual(["b", "a", "c"]);
  });

  it("drops a note before or after another within its group", () => {
    expect(reordered(notes, [], "c", "a", false)).toEqual(["p", "q", "c", "a", "b"]);
    expect(reordered(notes, [], "a", "b", true)).toEqual(["p", "q", "b", "a", "c"]);
    expect(reordered(notes, [], "q", "p", false)).toEqual(["q", "p", "a", "b", "c"]);
  });

  it("changes nothing across groups, onto itself or to the same place", () => {
    expect(reordered(notes, [], "a", "p", false)).toBeNull();
    expect(reordered(notes, [], "a", "a", true)).toBeNull();
    expect(reordered(notes, [], "a", "b", false)).toBeNull();
    expect(reordered(notes, [], "scratchpad", "a", false)).toBeNull();
  });

  it("moves one place up or down, and stops at the ends", () => {
    expect(nudged(notes, [], "b", -1)).toEqual(["p", "q", "b", "a", "c"]);
    expect(nudged(notes, [], "b", 1)).toEqual(["p", "q", "a", "c", "b"]);
    expect(nudged(notes, [], "a", -1)).toBeNull();
    expect(nudged(notes, [], "c", 1)).toBeNull();
  });

  it("reads a stored order and ignores anything else", () => {
    expect(parseOrder({ ids: ["a", 3, "b"] })).toEqual(["a", "b"]);
    expect(parseOrder(null)).toEqual([]);
    expect(parseOrder({ ids: "a" })).toEqual([]);
  });
});
