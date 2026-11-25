/** The commands of tavora-pack; anything else is a module folder to pack. */
export const COMMANDS = ["link", "publish", "withdraw", "key"] as const;
export type Command = (typeof COMMANDS)[number];

/**
 * The command the arguments ask for, or null to pack the module folder they name. Each command takes one more argument,
 * so a module folder named like one (`tavora-pack link --key k`, with a folder `link` there) is packed, not read as the
 * command; `./link` always is the folder.
 */
export function commandOf(positionals: readonly string[], isFolder: (name: string) => boolean): Command | null {
  const word = COMMANDS.find((command) => command === positionals[0]);
  if (!word) return null;
  return positionals.length === 1 && isFolder(word) ? null : word;
}
