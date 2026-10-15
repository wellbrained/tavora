/**
 * What changed in each version, newest first. Shown in Settings > Patch notes.
 * Every version bump of apps/desktop/package.json adds an entry here; a test
 * keeps the two in step.
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
    version: "0.1.0",
    date: "2026-10-15",
    title: "The first numbered version",
    notes: [
      "A game library with a rail: favorites, folders, your own order, and a Trash that keeps removed games for 30 days.",
      "Workspaces with docked panels, saved layouts and snapshots; the official Notes and To-Dos modules and the UI Playground.",
      "Add games from a built-in list or search more than 100,000 games online; without a connection the built-in list is used. Online search can be turned off in Settings.",
      "Games without an image get a generated badge; you can set your own letters or pick an image.",
      "A local profile with a picture, a first-run welcome and a Keyboard shortcuts list (Ctrl+/).",
      "Ctrl+K searches games, modules, layouts and settings.",
      "A Grayscale text option for OLED screens.",
      "The version and these patch notes in Settings.",
    ],
  },
];
