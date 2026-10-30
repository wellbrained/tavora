// The keypad and the keyboard: which keys each layout has, which keyboard keys press which pad key, and what a paste
// types. Pure, so the panel only has to hand over what it saw.
import type { en } from "./locales";

export type Key = { key: string; label: string; name?: keyof typeof en; kind: "digit" | "op" | "clear" | "equals" };

const digits = (keys: string[]) => keys.map((key) => ({ key, label: key, kind: "digit" as const }));

/** The classic pocket calculator. */
export const BASIC: Key[] = [
  { key: "clear", label: "C", name: "calc.clear", kind: "clear" },
  { key: "(", label: "(", name: "calc.open", kind: "op" },
  { key: ")", label: ")", name: "calc.close", kind: "op" },
  { key: "/", label: "÷", name: "calc.divide", kind: "op" },
  ...digits(["7", "8", "9"]),
  { key: "*", label: "×", name: "calc.times", kind: "op" },
  ...digits(["4", "5", "6"]),
  { key: "-", label: "−", name: "calc.minus", kind: "op" },
  ...digits(["1", "2", "3"]),
  { key: "+", label: "+", name: "calc.plus", kind: "op" },
  { key: "%", label: "%", name: "calc.percent", kind: "op" },
  { key: "0", label: "0", kind: "digit" },
  { key: ".", label: ".", name: "calc.point", kind: "digit" },
  { key: "=", label: "=", name: "calc.equals", kind: "equals" },
];

/** Laid out like the Windows calculator, with √, x², ± and ans, and a row for big numbers and rounding up. */
export const PLUS: Key[] = [
  { key: "k", label: "k", name: "calc.thousand", kind: "op" },
  { key: "m", label: "m", name: "calc.million", kind: "op" },
  { key: "b", label: "b", name: "calc.billion", kind: "op" },
  { key: "ceil", label: "⌈x⌉", name: "calc.ceil", kind: "op" },
  { key: "clear", label: "C", name: "calc.clear", kind: "clear" },
  { key: "(", label: "(", name: "calc.open", kind: "op" },
  { key: ")", label: ")", name: "calc.close", kind: "op" },
  { key: "/", label: "÷", name: "calc.divide", kind: "op" },
  { key: "sqrt", label: "√", name: "calc.sqrt", kind: "op" },
  { key: "square", label: "x²", name: "calc.square", kind: "op" },
  { key: "%", label: "%", name: "calc.percent", kind: "op" },
  { key: "*", label: "×", name: "calc.times", kind: "op" },
  ...digits(["7", "8", "9"]),
  { key: "-", label: "−", name: "calc.minus", kind: "op" },
  ...digits(["4", "5", "6"]),
  { key: "+", label: "+", name: "calc.plus", kind: "op" },
  ...digits(["1", "2", "3"]),
  { key: "negate", label: "±", name: "calc.negate", kind: "op" },
  { key: "ans", label: "ans", name: "calc.ans", kind: "op" },
  { key: "0", label: "0", kind: "digit" },
  { key: ".", label: ".", name: "calc.point", kind: "digit" },
  { key: "=", label: "=", name: "calc.equals", kind: "equals" },
];

const KEYBOARD: Record<string, string> = {
  Enter: "=",
  "=": "=",
  Backspace: "back",
  Escape: "clear",
  Delete: "clear",
  ",": ".",
  x: "*",
  X: "*",
  ":": "/",
  // The Windows calculator's own shortcuts.
  "@": "sqrt",
  q: "square",
  Q: "square",
  F9: "negate",
  k: "k",
  K: "k",
  m: "m",
  M: "m",
  b: "b",
  B: "b",
};

export type KeyPress = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };
export type KeyAction = { type: "copy" } | { type: "key"; name: string };

/**
 * What a key press does: Copy for Ctrl+C when no text is selected, a pad key for a typed sign or shortcut, or nothing.
 * A focused button, radio or tab keeps its own Enter, Escape, Backspace and Delete, so the keyboard can still press it.
 */
export function keyAction(press: KeyPress, context: { selection?: boolean; focusedControl?: boolean } = {}): KeyAction | null {
  if ((press.ctrlKey || press.metaKey) && press.key.toLowerCase() === "c" && !context.selection) return { type: "copy" };
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  if (context.focusedControl && ["Enter", "Escape", "Backspace", "Delete"].includes(press.key)) return null;
  const name = KEYBOARD[press.key] ?? (/^[\d.+\-*/%()]$/.test(press.key) ? press.key : null);
  return name ? { type: "key", name } : null;
}

/** The pad keys a paste types: plain signs and the k m b letters, with × ÷ − and a decimal comma turned into plain ones. */
export function pasteKeys(text: string): string[] {
  const plain = text.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, ".").toLowerCase();
  return [...plain].filter((char) => /^[\d.+\-*/%()kmb]$/.test(char));
}
