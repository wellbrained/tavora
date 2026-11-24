import { expect, it } from "vitest";
import { leftEmpty } from "./notes";

// A note made with New note and left empty goes when you leave it; one with only a title or only a picture stays.
it("counts a new note as empty only when it has no text, no title of its own and no picture", () => {
  const entry = { text: "  ", fixedTitle: "", images: [] as string[] };
  expect(leftEmpty(entry)).toBe(true);
  expect(leftEmpty({ ...entry, fixedTitle: "Shopping" })).toBe(false);
  expect(leftEmpty({ ...entry, images: ["0123456789abcdef0123456789abcdef"] })).toBe(false);
  expect(leftEmpty({ ...entry, text: "milk" })).toBe(false);
});
