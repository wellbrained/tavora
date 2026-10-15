/**
 * What changed in each version, newest first. Shown when the version at the bottom
 * of the Settings sections list is pressed (it is not a menu item).
 * Every version bump of apps/desktop/package.json adds an entry here; a test
 * keeps the two in step. Write for players, in plain friendly words. At 1.0 these
 * entries are replaced by a "1.0 release catalog" of all features, and a fresh
 * changelog starts (docs/decisions.md).
 */
export interface PatchNote {
  /** major.minor.patch, as in apps/desktop/package.json. */
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  /** A few words on what this version is about. */
  title: string;
  /** What players will notice, one line each. */
  notes: string[];
}

export const PATCH_NOTES: readonly PatchNote[] = [
  {
    version: "0.4.3",
    date: "2026-10-15",
    title: "A safety copy of your data",
    notes: [
      "Tavora now keeps a copy of your games, layouts, notes and settings from the last 7 days, made when it first starts each day. If something ever goes wrong, open Settings, then Backups, and press Open folder to find them.",
      "If you go back to an older version of Tavora, it no longer overwrites what a newer version saved: it keeps a copy of that file next to it first.",
    ],
  },
  {
    version: "0.4.2",
    date: "2026-10-15",
    title: "Game icons from your launchers",
    notes: [
      "Games installed through Battle.net, Epic, GOG, EA and other launchers now show their own icon, taken from the game on your PC. Games from Steam you don't have installed get Steam's small icon too, and the Steam setting in Settings now covers all of this.",
    ],
  },
  {
    version: "0.4.1",
    date: "2026-10-15",
    title: "Check for updates",
    notes: [
      "Settings now has a Check for updates button. Press it to see right away whether there is a newer version of Tavora, instead of waiting for the automatic check. It also tells you when it last looked.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-15",
    title: "The first version you can install",
    notes: [
      "Tavora now comes with an installer and keeps itself up to date. New versions download quietly in the background and install when you close the app. A small arrow at the bottom of the game list shows when an update is ready, and Settings has a switch if you would rather choose when updates download.",
      "Your games live in a list on the left. Pin favorites, sort games into folders, put them in your own order, and bring back anything you removed within 30 days.",
      "Every game has its own workspace. Arrange notes, to-do lists and other panels the way you like, and save layouts to come back to.",
      "Add a game by searching more than 100,000 titles online. No internet? A built-in list of popular games still works, and you can switch online search off in Settings.",
      "If Steam is installed on your PC, each game shows the same icon Steam uses for it, on a tile in Tavora's colours. Games without one keep a colourful badge, and an image you pick yourself always comes first. You can switch the Steam icons off in Settings.",
      "Make Tavora yours with a profile picture. A short welcome helps you get started, and Ctrl+/ shows every keyboard shortcut.",
      "Press Ctrl+K to find a game, a panel, a layout or a setting in seconds.",
      "A grayscale text option makes text crisper on OLED screens.",
      "Press the version number at the bottom of Settings to see which version you have and what changed.",
    ],
  },
];