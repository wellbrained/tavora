/**
 * An example's source as Show code shows it: the file itself, with Windows line ends made plain and the empty lines at
 * its ends cut off. Nothing else changes, so what a module author sees (and copies) is what runs.
 */
export function shownSource(source: string): string {
  return source.replace(/\r\n/g, "\n").trim();
}
