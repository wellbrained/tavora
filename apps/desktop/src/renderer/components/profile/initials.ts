/** Initials from a name: "Ada Lovelace" gives "AL", "Robin" gives "R". */
export function autoInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return picked.map((word) => [...word][0]!.toLocaleUpperCase()).join("");
}
