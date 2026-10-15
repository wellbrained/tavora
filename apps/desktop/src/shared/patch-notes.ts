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
    version: "0.5.8",
    date: "2026-10-15",
    title: "Tavora speaks German (second part)",
    notes: [
      "The rest of Tavora is in German now, too: the game list, menus, dialogs, search, the Steam import, the Browser panel and the messages Tavora shows. Pick Deutsch under Settings, then General, then Language, or leave it on Follow System. Notes and To-Dos follow next.",
    ],
  },
  {
    version: "0.5.7",
    date: "2026-10-15",
    title: "Tavora speaks German (first part)",
    notes: [
      "Settings has a new Language row: Follow System (the default), English or Deutsch. The change shows at once, and Tavora follows your system's language until you choose one. German is a first part for now: all of Settings is translated, and the rest of Tavora follows in the next versions.",
    ],
  },
  {
    version: "0.5.6",
    date: "2026-10-15",
    title: "A browser next to your game",
    notes: [
      "New Browser module: open wikis, maps, guides and videos in a panel beside your notes. Find it under Add module.",
      "Ads and trackers are blocked. If a site breaks, press the shield in the toolbar to allow ads there.",
      "Sign-ins are kept for each game on its own. Press the people button to stay signed in to a site for all your games.",
      "Videos go full screen inside the panel, and Esc brings them back.",
      "Files are never downloaded and pages can't use your camera, location or notifications. Open in your browser takes the page to your normal browser.",
      "Settings, then Browser, lists your sites and can clear the browser data.",
    ],
  },
  {
    version: "0.5.5",
    date: "2026-10-15",
    title: "Remember my Steam profile",
    notes: [
      "The Steam import can now remember your profile link. Tick Remember this profile on this PC and it is filled in next time. It stays on your PC only; untick it and look up again to forget it.",
    ],
  },
  {
    version: "0.5.4",
    date: "2026-10-15",
    title: "Your modules, in one place",
    notes: [
      "Settings has a new Modules page. It lists every module Tavora found and where it came from. Open folder shows your own modules folder, and Reload picks up a module you just put there. Modules in your folder can be removed again; they go to the recycle bin and their notes and data stay, so adding one back finds everything.",
      "If a folder in your modules folder cannot be loaded, the page says which one and why.",
      "Notes and To-Dos cope better with damaged or hand-edited data: a note whose formatting cannot be read shows its plain text, and a to-do list only keeps web links and a sensible amount of items.",
    ],
  },
  {
    version: "0.5.3",
    date: "2026-10-15",
    title: "Bring your Steam games",
    notes: [
      "You can now add the games you own on Steam in one go. Open Add a game and choose Import your games from Steam (or use Settings, then General, then Import from Steam), paste your profile link, look at the list and tick the games you want. Games you already have are marked and left alone. Tavora only lists them: it does not start games.",
    ],
  },
  {
    version: "0.5.2",
    date: "2026-10-15",
    title: "Help when something goes wrong",
    notes: [
      "Settings, then General, has a new Diagnostic info button. It copies Tavora's version, your system, how long things took, the update log and the last errors, so you can paste it to whoever is helping you. It leaves out game names, notes and folders, and nothing is sent anywhere.",
    ],
  },
  {
    version: "0.5.1",
    date: "2026-10-15",
    title: "Light or dark, like your system",
    notes: [
      "Tavora now follows your system: when your computer switches between light and dark, Tavora and its modules switch with it, using the Light or Dark version of your theme. Settings, then Appearance, has a Light or dark choice where you can stay in Dark or Light instead.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-15",
    title: "Themes, game icons and a safety copy",
    notes: [
      "Settings has a new Appearance section where you can pick how Tavora looks. Every theme is shown in its own colours before you pick it, and your modules change colour along with Tavora.",
      "Three themes come with Tavora, each in Dark and Light: Tavora with its warm charcoal and gold, Nightfall in cool slate and moonlight blue, and Hearthwood in deep forest green.",
      "You can make your own theme: press New theme in Appearance to get a copy of the Tavora theme in your themes folder, change its colours, and press Reload. Reset to Tavora Default always takes you back.",
      "Games installed through Battle.net, Epic, GOG, EA and other launchers now show their own icon, taken from the game on your PC. Games you have not installed can show theirs too, from a small, growing set Tavora keeps: when Online game search is on, Tavora asks only for the icons of your own games, and the service keeps no log of what is asked. Game names and icons belong to their publishers, and Tavora is not affiliated with them.",
      "Change icon now has three plain choices: Original icon, Set letters and Select own icon. The one in use is ticked, and picking another replaces it, so there is no separate Reset. Letters you set now always show, even for a game that has its own icon.",
      "If your PC has a game's own icon that Tavora does not have yet, you can share it: right-click the game and choose Share icon, or open Settings and press Share. You see exactly what is sent (the icon, the game's id and its name, nothing about you), and a person at Tavora checks each one before anyone else sees it.",
      "Tavora now keeps a copy of your games, layouts, notes and settings from the last 7 days, made when it first starts each day. If something ever goes wrong, open Settings, then Backups, and press Open folder to find them. If you go back to an older version of Tavora, it no longer overwrites what a newer version saved: it keeps a copy of that file next to it first.",
      "The UI Playground and the example modules now have their own Development category in the module library, so they no longer sit between Notes, To-Dos and your own modules. They are still there for anyone who wants to try building a module.",
    ],
  },  {
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