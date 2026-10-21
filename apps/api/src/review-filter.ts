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
  if (LINK.test(text)) return "link";
  const words = ` ${plainWords(text)} `;
  if (WORDS.some((word) => words.includes(` ${word} `))) return "words";
  const joined = words.replace(/ /g, "");
  if (PARTS.some((part) => joined.includes(part))) return "words";
  return "ok";
}
