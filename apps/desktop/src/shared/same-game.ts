// Whether two names for a game are one game: the library's copy and a game found on this PC, in a Steam library or in a
// list. Pure, so the host and the host window decide it alike.

const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/** A name reduced to what two spellings of one game share: "Diablo® IV" and "Diablo 4" are the same. */
export function normalizeName(name: string): string {
  const tokens = name
    // Steam writes "Battlefield™ 6"; NFKD would turn the sign into the letters "tm".
    .replace(/[™℠®©]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return tokens.map((token, i) => (i > 0 ? (ROMAN[token] ?? token) : token)).join("");
}

/** What names a game across lists: Tavora's id (null for none), Steam's app id (null for none) and its name. */
export interface GameIdentity {
  id: string | null;
  steamAppId: number | null;
  name: string;
}

/**
 * Whether these are one game: the same Tavora id; else, when both have a Steam app id, only that decides ("Doom" 2280
 * isn't "DOOM" 379720); else the same name, ignoring case, punctuation, ® and ™ (a game added by hand is the same game).
 */
export function isSameGame(a: GameIdentity, b: GameIdentity): boolean {
  if (a.id !== null && a.id === b.id) return true;
  if (a.steamAppId !== null && b.steamAppId !== null) return a.steamAppId === b.steamAppId;
  const name = nameKey(a);
  return name !== "" && name === nameKey(b);
}

/** Each game's normalized name, worked out once while its name stays (a Steam library is matched against every copy). */
const nameKeys = new WeakMap<GameIdentity, { name: string; key: string }>();

function nameKey(game: GameIdentity): string {
  const known = nameKeys.get(game);
  if (known?.name === game.name) return known.key;
  const key = normalizeName(game.name);
  nameKeys.set(game, { name: game.name, key });
  return key;
}
