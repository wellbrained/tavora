// Formulas in the user's language and back. Stored formulas are always in the English form (=ROUND(A1,2), 1.5);
// German shows and takes =ROUND(A1;2) and 1,5. An English formula pasted into German Tavora is recognised and kept.
// Function names are English in both, as in Google Sheets, so community sheets work as they are.

export type Lang = "en" | "de";

interface Scan {
  /** Index of each character's kind: inside a "string", a 'sheet name', or neither. */
  quoted: boolean[];
}

function scan(source: string): Scan {
  const quoted: boolean[] = [];
  let mode: '"' | "'" | null = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (mode) {
      quoted.push(true);
      if (char === mode) {
        if (source[i + 1] === mode) {
          quoted.push(true);
          i++;
        } else mode = null;
      }
      continue;
    }
    if (char === '"' || (char === "'" && isSheetQuote(source, i))) {
      mode = char;
      quoted.push(true);
      continue;
    }
    quoted.push(false);
  }
  return { quoted };
}

/** A ' that starts a quoted sheet name ('Boss runs'!A1), not an apostrophe somewhere odd. */
function isSheetQuote(source: string, at: number): boolean {
  const before = source[at - 1];
  return before === undefined || /[\s(=,;+\-*/^&<>:]/.test(before);
}

/** Whether the digits right before `at` are a plain number (1,5), not the end of a reference (A1,5). */
function numberBefore(source: string, at: number): boolean {
  let i = at - 1;
  if (i < 0 || !/\d/.test(source[i]!)) return false;
  while (i >= 0 && /\d/.test(source[i]!)) i--;
  return i < 0 || !/[A-Za-z_$.À-￿]/.test(source[i]!);
}

const digitAfter = (source: string, at: number) => /\d/.test(source[at + 1] ?? "");

/**
 * Whether a formula typed in German is really in the English form: it has no ";", and a "," inside brackets that
 * is no decimal comma (=ROUND(A1,2)), or a decimal point (=A1*1.5). =1,5*2 and =ROUND(1,5) read as German.
 */
export function looksEnglish(formula: string): boolean {
  const { quoted } = scan(formula);
  let depth = 0;
  let commaInside = false;
  for (let i = 0; i < formula.length; i++) {
    if (quoted[i]) continue;
    const char = formula[i];
    if (char === ";") return false;
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth > 0 && !(numberBefore(formula, i) && digitAfter(formula, i))) commaInside = true;
  }
  return commaInside || /\d\.\d/.test(stripQuoted(formula, quoted));
}

function stripQuoted(source: string, quoted: boolean[]): string {
  return [...source].map((char, i) => (quoted[i] ? " " : char)).join("");
}

/** A formula as typed (in the language shown) in its stored, English form. */
export function formulaToStored(input: string, lang: Lang): string {
  if (lang === "en" || !input.startsWith("=") || looksEnglish(input)) return input;
  const { quoted } = scan(input);
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted[i]) out += char;
    else if (char === ";") out += ",";
    else if (char === "," && numberBefore(input, i) && digitAfter(input, i)) out += ".";
    else out += char;
  }
  return out;
}

/** A stored formula as the language shows it. */
export function formulaToShown(stored: string, lang: Lang): string {
  if (lang === "en" || !stored.startsWith("=")) return stored;
  const { quoted } = scan(stored);
  let out = "";
  for (let i = 0; i < stored.length; i++) {
    const char = stored[i]!;
    if (quoted[i]) out += char;
    else if (char === ",") out += ";";
    else if (char === "." && numberBefore(stored, i) && digitAfter(stored, i)) out += ",";
    else out += char;
  }
  return out;
}

/** The separator between a function's arguments in a language. */
export const argumentSeparator = (lang: Lang): string => (lang === "de" ? ";" : ",");
