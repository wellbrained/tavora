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
    version: "0.1.1",
    date: "2026-10-15",
    title: "Tidier Settings",
    notes: ["The patch notes now open only when you press the version number at the bottom of Settings. They no longer show up as a menu entry or in search."],
  },
  {
    version: "0.1.0",
    date: "2026-10-15",
    title: "The first numbered version",
    notes: [
      "Your games live in a list on the left. Pin favorites, sort games into folders, put them in your own order, and bring back anything you removed within 30 days.",
      "Every game has its own workspace. Arrange notes, to-do lists and other panels the way you like, and save layouts to come back to.",
      "Add a game by searching more than 100,000 titles online. No internet? A built-in list of popular games still works, and you can switch online search off in Settings.",
      "Games without a picture get a colourful badge. You can change its letters or choose your own image.",
      "Make Tavora yours with a profile picture. A short welcome helps you get started, and Ctrl+/ shows every keyboard shortcut.",
      "Press Ctrl+K to find a game, a panel, a layout or a setting in seconds.",
      "A grayscale text option makes text crisper on OLED screens.",
      "You can now see which version of Tavora you have, and what changed, right here in Settings.",
    ],
  },
];
