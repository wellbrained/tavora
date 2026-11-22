/**
 * The word filter for reviews and replies (decided 2026-10-21): a review goes live at once, so what
 * must never show is stopped before it is stored. It refuses slurs and anything that reads like a link
 * or an email address; everything else is left to Report and a person on the admin page. It is a
 * short list on purpose: a long one refuses honest reviews, and reports catch the rest.
 */

/** Letters people swap in to get around a filter, read back as the letter they stand for. */
const LOOKALIKE: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g", "@": "a", $: "s", "!": "i", "|": "i" };

/** Letters of other alphabets that look like a Latin one, written as escapes so they can't be mistaken for it here. */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "к": "k", "м": "m", "т": "t",
  "і": "i", "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d",
  // Greek
  "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
  // Latin letters outside a to z
  "ɑ": "a", "ɡ": "g", "ı": "i",
};
const HOMOGLYPH = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");

/**
 * Words refused on their own (whole words after lookalikes are read back), in English and German.
 * Slurs against a group, and the strongest insults; plain swearing ("shit", "Scheiße") stays allowed.
 */
const WORDS = [
  "nigger", "nigga", "niggers", "niggas", "nlgger", "nlggers", "faggot", "faggots", "fag", "fags", "retard", "retards", "retarded", "tranny", "trannies",
  "kike", "kikes", "spic", "spics", "chink", "chinks", "gook", "gooks", "wetback", "wetbacks", "raghead", "ragheads", "coon", "coons",
  "cunt", "cunts", "whore", "whores", "slut", "sluts", "rape", "raped", "rapist",
  "neger", "kanake", "kanaken", "schwuchtel", "schwuchteln", "spast", "spasti", "spasten", "fotze", "fotzen", "hure", "huren", "nutte", "nutten",
  "zigeuner", "judensau", "missgeburt", "vergewaltigen", "vergewaltigt",
  "heil hitler", "sieg heil", "kys", "kill yourself", "bring dich um",
];

/** Parts refused even inside a longer word, where no honest word holds them. */
const PARTS = ["nigga", "nlgga", "faggot", "schwuchtel", "judensau"];

/**
 * Something that reads like a web address, a bare domain or an email address.
 *
 * It runs over untrusted text of up to 20 KB (a module readme) on the service's one event loop, so it must stay linear: the
 * domain and email parts start only where their run of characters starts (the lookbehinds), so no run is scanned again from
 * every position inside it. The leftmost address in a run starts there anyway. The email part is "name@x.y" with one `@` before
 * the dot (an `@` right after the first one counts as part of the domain), so it never tries every `@` and every dot in a long
 * run of them (`\S+@\S+\.\S+` did, cubic in the run's length).
 */
const LINK = /(?:https?:\/\/|www\.|(?<![a-z0-9-])[a-z0-9-]+(?:\.|\s?(?:\(dot\)|\[dot\])\s?)(?:com|net|org|io|gg|de|at|ch|ru|xyz|app|ly|me|co|tv|link|site|shop|info|biz|eu|uk|us)\b|(?<![^\s@])[^\s@]+@\S[^\s.@]*\.\S+|discord\.gg|t\.me\/)/i;
const LINK_GLOBAL = new RegExp(LINK.source, "gi");

/**
 * A sentence that only lacks the space after its full stop ("Great game.Me too"): a plain word, umlauts included, then one of
 * the address endings that also start a sentence, capitalised, with the sentence going on after it on the same line.
 */
const MISSING_SPACE = /^\p{Lu}?\p{Ll}{2,}\.(?:Me|At|Us)$/u;
/** The same shape with `.App`, which is as likely a real address ("freerobux.App now") as a sentence ("Modul.App läuft"): a person decides. */
const MAYBE_ADDRESS = /^\p{Lu}?\p{Ll}{2,}\.App$/u;
const WORD_CHAR = /[\p{L}\p{N}-]/u;

/** "link" for what reads as an address, "hold" when only a person can tell, null when there is neither. */
function linkIn(original: string): "link" | "hold" | null {
  // A full-width dot opens the same address in a browser, and NFKC reads it back, with full-width letters ("ｃｏｍ"); it also
  // makes the half-width full stop the Japanese one. That full stop ends sentences too, so it counts as a dot only before a
  // Latin word that ends there ("free。com now"), not one a sentence goes on from ("このmod。Co-opも").
  const text = original.normalize("NFKC").replace(/。(?=[a-z0-9-]+(?:[^\p{L}\p{N}-]|$))/giu, ".");
  let found: "hold" | null = null;
  for (const match of text.matchAll(LINK_GLOBAL)) {
    if (!/^[ \t]+\p{L}/u.test(text.slice(match.index + match[0].length))) return "link";
    // The address pattern knows only a to z, so "schön.Me" matches from its "n": read the whole word.
    let start = match.index;
    while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start--;
    const word = text.slice(start, match.index) + match[0];
    if (MISSING_SPACE.test(word)) continue;
    if (!MAYBE_ADDRESS.test(word)) return "link";
    found = "hold";
  }
  return found;
}

/**
 * A part inside one word, or spread over words from the start of one or one letter into it ("nig ga", "xnig ga"). Further in
 * doesn't count: "wenig Gameplay" and "König gab" only hold the letters across a word gap, in the middle of an honest word,
 * and two stray letters in front are left to reports.
 */
function holdsPart(words: readonly string[]): boolean {
  return PARTS.some((part) =>
    words.some((word, index) => {
      if (word.includes(part)) return true;
      const run = words.slice(index, index + part.length + 1).join("");
      return run.startsWith(part) || run.startsWith(part, 1);
    }),
  );
}

/** A word with letters of another alphabet swapped in, read back. A word that also has letters without a Latin twin is left alone: it is honest Russian or Greek. */
function latinWord(word: string): string {
  const read = word.replace(HOMOGLYPH, (char) => HOMOGLYPHS[char] ?? char);
  return /^[a-z]+$/.test(read) ? read : word;
}

const readDigit = (digit: string) => LOOKALIKE[digit] ?? digit;

/** A model or part code: one or two letters, then one or two digits, three or four characters in all ("F46", "FA6", "X64"). */
const PART_CODE = /^\p{L}{1,2}\d{1,2}$/u;
/** Codes that are no product's, only a slur or a threat read back ("ky5", "fa65"): these are read like any other word. */
const NOT_A_CODE = new Set(["kys", "fags"]);
/** A year joined to a word ("in1994er", "den1994er Modellen"): a number, never letters. */
const JOINED_YEAR = /^(?:19|20)\d\d(?:er|ern|s|th)?$/;

/**
 * Digits read as letters only inside a word that has letters too, so a number stays a number: "in 1994", "on1994" and "1994er"
 * hold no letters to join up with the word before them. Digits with letters on both sides are always read ("ni99a", "f4990t").
 * At the end of a word at most two are, and none of a part code ("BMW F46"); at its start only a single one ("5lut").
 */
function readDigits(token: string): string {
  if (!/\p{L}/u.test(token)) return token;
  const code = token.length >= 3 && PART_CODE.test(token) && !NOT_A_CODE.has(token.replace(/\d/g, readDigit));
  return token.replace(/\d+/g, (run: string, at: number) => {
    const lettersBefore = at > 0;
    // A 2 stands for no letter, so a run holding one is a number ("i512600k", "F462A"), and so is a year after a word.
    if (run.includes("2") || (lettersBefore && JOINED_YEAR.test(token.slice(at)))) return run;
    const lettersAfter = at + run.length < token.length;
    const read = lettersBefore && lettersAfter ? true : lettersBefore ? run.length <= 2 && !code : run.length === 1;
    return read ? run.replace(/\d/g, readDigit) : run;
  });
}

/** Single characters in a row ("n 1 g g a"), with at least two letters among them, so a lone number isn't read as a letter. */
const SPACED_OUT = /(?<![\p{L}\p{N}])(?:[\p{L}\d][^\p{L}\p{N}]+){2,}[\p{L}\d](?![\p{L}\p{N}])/gu;
const readSpacedOut = (run: string) => ((run.match(/\p{L}/gu)?.length ?? 0) >= 2 ? run.replace(/\d/g, readDigit) : run);

function plainWords(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(SPACED_OUT, readSpacedOut)
    .replace(/[\p{L}\p{N}]+/gu, readDigits)
    .replace(/[@$!|]/g, (char) => LOOKALIKE[char] ?? char)
    .replace(/\p{L}+/gu, latinWord)
    .replace(/[^a-z]+/g, " ")
    // "n i g g e r" or "f.a.g": single letters in a row are read as one word.
    .replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (run) => run.replace(/ /g, ""))
    .replace(/(.)\1{2,}/g, "$1$1")
    .trim();
}

/** `hold`: it may be an address, so a review with it waits for a person; a reply or message, which can't wait, is refused as a link. */
export type FilterResult = "ok" | "words" | "link" | "hold";

/** Whether the text holds a slur, in any spelling plainWords reads back. */
function holdsWords(text: string): boolean {
  const plain = plainWords(text);
  // Doubled vowels read as one ("niigga", "faaggot"). Only for comparing, and consonants stay: "Rappe" isn't "rape", "Minigame" holds no slur.
  const single = plain.replace(/([aeiou])\1+/g, "$1");
  return (plain === single ? [plain] : [plain, single]).some((reading) => {
    const words = ` ${reading} `;
    return WORDS.some((word) => words.includes(` ${word} `)) || holdsPart(reading.split(" "));
  });
}

/** Whether a review or reply may be posted as it is. */
export function checkReviewText(text: string): FilterResult {
  const link = linkIn(text);
  if (link === "link") return "link";
  if (holdsWords(text)) return "words";
  return link ?? "ok";
}

/**
 * Adult / 18+ terms (decided 2026-10-26): the catalog has no age check, so a module about them waits for
 * a person. They are only checked in module texts (checkModuleText), not in reviews. A wrong hit costs
 * a short wait for review, never a refusal.
 */
const ADULT_WORDS = [
  "porn", "porno", "pornos", "pornhub", "pornographic", "pornography", "hentai", "nsfw", "erotic", "erotica", "nude", "nudes", "nudity", "nudist",
  "sexcam", "sexcams", "camgirl", "camgirls", "onlyfans", "fetish", "bdsm", "blowjob", "handjob", "cumshot", "orgasm", "milf", "lewd", "lewds",
  "sex tape", "sex game", "sex games", "sex mod", "sex scene", "sex scenes", "adult content", "adults only", "adult only", "sexual content", "explicit content",
  "porno", "pornografie", "erotik", "nacktbilder", "nacktfotos", "sexspiel", "sexspiele", "ab 18", "nur fuer erwachsene",
];

/** "18+", "+18" and the likes, which the letters-only reading above drops. */
const ADULT_RAW = /(?:^|[^\d.])(?:ab\s?18\b|18\s?\+|\+\s?18\b|18\s?plus\b|xxx+\b|r18\b|r-18\b)/i;

export type ModuleTextResult = "ok" | "words" | "adult";

/**
 * Whether a module's text (name, descriptions in every language, changelog notes, readme) may list without a
 * look: the slur list of the reviews, plus the adult terms. Links are fine here, a readme has them.
 */
export function checkModuleText(text: string): ModuleTextResult {
  // The words without the links, never cut short by a link the cut left behind ("a.com-b.com" keeps "-b.com").
  if (holdsWords(text.replace(LINK_GLOBAL, " "))) return "words";
  const words = ` ${plainWords(text)} `;
  if (ADULT_WORDS.some((word) => words.includes(` ${word} `)) || ADULT_RAW.test(text)) return "adult";
  return "ok";
}
