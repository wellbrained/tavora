import { expect, it } from "vitest";
import { countsAsPress } from "./press";

const event = (type: string, fields: Record<string, unknown> = {}) => ({ type, isTrusted: true, repeat: false, key: "a", ...fields }) as unknown as Event;

it("counts a real click and a real key press", () => {
  expect(countsAsPress(event("pointerdown"))).toBe(true);
  expect(countsAsPress(event("keydown", { key: "Enter" }))).toBe(true);
  expect(countsAsPress(event("keydown", { key: "c", ctrlKey: true }))).toBe(true);
});

it("doesn't count a script's event, a held key's repeats or a modifier alone", () => {
  expect(countsAsPress(event("pointerdown", { isTrusted: false }))).toBe(false);
  expect(countsAsPress(event("keydown", { isTrusted: false }))).toBe(false);
  expect(countsAsPress(event("keydown", { repeat: true }))).toBe(false);
  for (const key of ["Control", "Shift", "Alt", "AltGraph", "Meta", "CapsLock"]) expect(countsAsPress(event("keydown", { key }))).toBe(false);
});
