// @vitest-environment jsdom
// The calculator takes the page's keys, except those meant for a field, a dialog or an open menu: Enter on a value's
// Rename must not also work out the sum, Escape closing the menu must not clear it.
import { afterEach, expect, it } from "vitest";
import { meantElsewhere } from "./keys";

afterEach(() => document.body.replaceChildren());

const inside = (html: string) => {
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>("[data-target]")!;
};

it("leaves keys in a field, a dialog or a menu to them", () => {
  expect(meantElsewhere(inside(`<input data-target>`))).toBe(true);
  expect(meantElsewhere(inside(`<div role="dialog"><button data-target></button></div>`))).toBe(true);
  expect(meantElsewhere(inside(`<div role="menu"><div role="menuitem" data-target>Rename</div></div>`))).toBe(true);
  expect(meantElsewhere(inside(`<button data-target>7</button>`))).toBe(false);
});

it("leaves a key alone that something already handled", () => {
  expect(meantElsewhere(inside(`<button data-target>7</button>`), true)).toBe(true);
});

it("takes @ typed with AltGr (Windows) or Option (Mac), as on a German keyboard, but not Alt with a letter", async () => {
  const { keyAction } = await import("./keys");
  expect(keyAction({ key: "@", ctrlKey: true, metaKey: false, altKey: true })).toEqual({ type: "key", name: expect.any(String) });
  expect(keyAction({ key: "@", ctrlKey: false, metaKey: false, altKey: true })).toEqual({ type: "key", name: expect.any(String) });
  expect(keyAction({ key: "r", ctrlKey: false, metaKey: false, altKey: true })).toBeNull();
  expect(keyAction({ key: "@", ctrlKey: false, metaKey: true, altKey: false })).toBeNull();
});
