/**
 * The word filter for reviews and replies (decided 2026-10-21): a review goes live at once, so what
 * must never show is stopped before it is stored. It refuses slurs and anything that reads like a link
 * or an email address; everything else is left to Report and a person on the admin page. It is a
 * short list on purpose: a long one refuses honest reviews, and reports catch the rest.
 */

/** Letters people swap in to get around a filter, read back as the letter they stand for. */
const LOOKALIKE: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "!": "i", "|": "i" };

/**
 * Words refused on their own (whole words after lookalikes are read back), in English and German.
 * Slurs against a group, and the strongest insults; plain swearing ("shit", "Scheiße") stays allowed.
 */
const WORDS = [
  "nigger", "nigga", "niggers", "niggas", "faggot", "faggots", "fag", "fags", "retard", "retards", "retarded", "tranny", "trannies",
  "kike", "kikes", "spic", "spics", "chink", "chinks", "gook", "gooks", "wetback", "wetbacks", "raghead", "ragheads", "coon", "coons",
  "cunt", "cunts", "whore", "whores", "slut", "sluts", "rape", "raped", "rapist",
  "neger", "kanake", "kanaken", "schwuchtel", "schwuchteln", "spast", "spasti", "spasten", "fotze", "fotzen", "hure", "huren", "nutte", "nutten",
  "zigeuner", "judensau", "missgeburt", "vergewaltigen", "vergewaltigt",
  "heil hitler", "sieg heil", "kys", "kill yourself", "bring dich um",
];

/** Parts refused even inside a longer word, where no honest word holds them. */
const PARTS = ["nigga", "faggot", "schwuchtel", "judensau"];

/** Something that reads like a web address, a bare domain or an email address. */
const LINK = /(?:https?:\/\/|www\.|[a-z0-9-]+(?:\.|\s?(?:\(dot\)|\[dot\])\s?)(?:com|net|org|io|gg|de|at|ch|ru|xyz|app|ly|me|co|tv|link|site|shop|info|biz|eu|uk|us)\b|\S+@\S+\.\S+|discord\.gg|t\.me\/)/i;
const LINK_GLOBAL = new RegExp(LINK.source, "gi");

/**
 * A sentence that only lacks the space after its full stop ("Great game.Me too", "Modul.App läuft"): a plain word, umlauts
 * included, then one of the address endings that also start a sentence, capitalised, with the sentence going on after it on
 * the same line. Anything else stays a link.
 */
const MISSING_SPACE = /^\p{Lu}?\p{Ll}{2,}\.(?:Me|At|Us|App)$/u;
const WORD_CHAR = /[\p{L}\p{N}-]/u;

function holdsLink(text: string): boolean {
  for (const match of text.matchAll(LINK_GLOBAL)) {
    const sentenceGoesOn = /^[ \t]+\p{L}/u.test(text.slice(match.index + match[0].length));
    // The address pattern knows only a to z, so "schön.Me" matches from its "n": read the whole word.
    let start = match.index;
    while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start--;
    if (!(MISSING_SPACE.test(text.slice(start, match.index) + match[0]) && sentenceGoesOn)) return true;
  }
  return false;
}

/**
 * A part inside one word, or spread over words from the start of one or one letter into it ("nig ga", "xnig ga"). Further in
 * doesn't count: "wenig Gameplay" and "König gab" only hold the letters across a word gap, in the middle of an honest word.
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

function plainWords(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[0-9@$!|]/g, (char) => LOOKALIKE[char] ?? char)
    .replace(/[^a-z]+/g, " ")
    // "n i g g e r" or "f.a.g": single letters in a row are read as one word.
    .replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (run) => run.replace(/ /g, ""))
    .replace(/(.)\1{2,}/g, "$1$1")
    .trim();
}

export type FilterResult = "ok" | "words" | "link";

/** Whether a review or reply may be posted as it is. */
export function checkReviewText(text: string): FilterResult {
  if (holdsLink(text)) return "link";
  const plain = plainWords(text);
  const words = ` ${plain} `;
  if (WORDS.some((word) => words.includes(` ${word} `))) return "words";
  return holdsPart(plain.split(" ")) ? "words" : "ok";
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
  if (checkReviewText(text.replace(LINK_GLOBAL, " ")) === "words") return "words";
  const words = ` ${plainWords(text)} `;
  if (ADULT_WORDS.some((word) => words.includes(` ${word} `)) || ADULT_RAW.test(text)) return "adult";
  return "ok";
}
