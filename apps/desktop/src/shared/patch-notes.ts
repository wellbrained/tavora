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
    version: "0.14.0",
    date: "2026-10-16",
    title: "Choose where module pictures are kept",
    notes: [
      "Settings > Modules has a new Module pictures folder setting: move the pictures of Notes (and other modules) to another drive, open the folder, or go back to the default. Tavora copies the pictures, checks them, and only then switches over, so nothing is lost if something goes wrong.",
      "If a folder you chose is not there when Tavora starts (an unplugged drive, say), you get a notice, the pictures show as missing, and nothing is deleted.",
  },
  {
    version: "0.13.1",
    date: "2026-10-16",
    title: "Pictures: text flows around them",
    notes: [
      "A picture can now sit at the left or right with the text flowing around it, at the size it has. This replaces \"Inline\", which shrank the picture to the height of a line. Dragging the corner resizes any picture.",
    ],
  },
  {
    version: "0.13.0",
    date: "2026-10-16",
    title: "Pictures in Notes",
    notes: [
      "Paste a screenshot, drop a picture file into a note, or use the Insert image button (PNG, JPEG, GIF, WebP). Click a picture to put it inline with the text or on its own line as Small, Medium or Full width, drag its corner to resize it freely, open it larger, or remove it.",
      "Choose Optimized (shrunk to at most 1600 px, smaller files) or Original (the file exactly as it is) under the Insert image button. The menu also shows how much picture space the game has used.",
      "Pictures of deleted notes are cleaned up the next time Notes opens.",
    ],
  },
  {
    version: "0.12.0",
    date: "2026-10-16",
    title: "Modules can keep pictures",
    notes: [
      "Modules can now store pictures (PNG, JPEG, GIF, WebP, up to 50 MB each and 500 MB per game) in a folder Tavora manages. Nothing uses it yet: Notes will, next. The pictures are removed with the game and are part of the daily backup unless it would get too big.",
    ],
  },
  {
    version: "0.11.1",
    date: "2026-10-16",
    title: "Links: hand cursor and a choice",
    notes: [
      "In Notes, links show a hand cursor while you hold Ctrl, so you can tell a click will open them.",
      "When a link is opened and the game has no Browser panel, Tavora now asks whether to use a new Browser panel or your system browser.",
    ],
  },
  {
    version: "0.11.0",
    date: "2026-10-16",
    title: "Links in Notes open in the Browser",
    notes: [
      "Click a link in a note to see its address with Open, Edit and Remove. Ctrl+click opens it straight away, as a new tab in your Browser panel (or in a new Browser panel if you have none).",
      "Modules can now ask Tavora to open a web address, but only right after you click or press a key in them.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-10-16",
    title: "Notes: reorder and undo",
    notes: [
      "Drag notes in the list to put them in your own order (Alt+Up and Alt+Down work too). Pinned notes and the rest keep their own groups, and new notes still come last.",
      "Deleting a note or clearing the scratchpad no longer asks first. It happens at once, and an Undo notice stays for 10 seconds (it waits while the pointer is on it).",
    ],
  },
  {
    version: "0.9.1",
    date: "2026-10-16",
    title: "Cleaner folders",
    notes: ["Folders in the sidebar no longer show a number badge."],
  },
  {
    version: "0.9.0",
    date: "2026-10-16",
    title: "Notes: fonts and sizes",
    notes: [
      "Pick a font and a size for the text in Notes (the Aa button in the toolbar): Inter, Open Sans, Lora, Merriweather or JetBrains Mono, from Small to Extra large. The scratchpad has its own setting, and both work offline.",
      "New notes now come last in the list, and editing a note no longer moves it.",
    ],
  },
  {
    version: "0.8.1",
    date: "2026-10-16",
    title: "Notes: roomier collapsed sidebar",
    notes: ["In the collapsed Notes sidebar the icons have more room, so the selected one is no longer cut off at the top."],
  },
  {
    version: "0.8.0",
    date: "2026-10-16",
    title: "Notes: titles, a resizable sidebar and a handier scratchpad",
    notes: [
      "Give a note a title of your own: type it above the text, or double-click the note in the list (F2 also works). Leave it empty and the first line stays the title.",
      "The notes list can be dragged wider or narrower, and collapsed to a thin strip of icons. Each Notes panel remembers its own.",
      "The scratchpad has two new buttons: Save as note moves its text into a note of its own, and Clear empties it.",
      "Headers and headings in Notes now use the theme's accent colour.",
      "Switching games no longer shows panels building themselves: a panel appears once it has its content.",
    ],
  },
  {
    version: "0.7.2",
    date: "2026-10-16",
    title: "Modules can't fill your disk",
    notes: [
      "A module can keep at most 256 MB in its own browser storage for each game. If one goes past that, Tavora clears that storage, restarts its panel and tells you. Notes and settings a module saved through Tavora are not touched.",
    ],
  },
  {
    version: "0.7.1",
    date: "2026-10-16",
    title: "Safer modules",
    notes: [
      "A misbehaving module can no longer crash Tavora by sending it huge amounts of data. Such a module now only slows itself down.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-16",
    title: "AI Usage panel",
    notes: [
      "New panel: AI Usage. It shows how much of your Claude and Codex subscription allowance is left for each of your accounts, with a bar for the 5-hour and weekly windows and a countdown to the reset. Open it from the module list like any other panel.",
      "Add your accounts in Settings > Integrations > AI usage, by the folder of each login (such as .claude or .codex in your user folder). Tavora offers the ones it finds on this PC the first time. Tavora reads the allowance only while a panel is open, never saves or shows your logins, and a reading that is old or failed is marked Last known.",
      "Settings > Integrations > AI usage can show the numbers as what is left or what is used. A Codex account also shows how many manual resets you have left, and its signed-in email when you hover its name.",
    ],
  },
  {
    version: "0.6.1",
    date: "2026-10-16",
    title: "Discord connects without a secret",
    notes: [
      "Discord no longer asks you to paste a Client Secret. Open a Discord panel, press Connect and approve Tavora in Discord. Nothing secret is kept on your PC anymore. For now Discord lets only approved testers of Tavora do this; if Discord refuses, ask to be added as a tester.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-16",
    title: "Discord, a Browser, German and a tidier sidebar",
    notes: [
      "New Discord module: see who is in your voice channel, who is talking and who is muted, without leaving your game. Remember a server for each game, jump between voice channels, and Mute, Deafen, Leave or Rejoin from the panel. Right-click a person to set their volume or mute them for yourself. Tavora can't hear, talk or read messages. Connect it under Settings, then Integrations.",
      "New Browser module: open wikis, maps, guides and videos in a panel beside your notes, with tabs (Ctrl+T, Ctrl+W). Ads and trackers are blocked, sign-ins are kept for each game, and files are never downloaded.",
      "Tavora speaks German. Pick Deutsch under Settings, then General, then Language, or leave it on Follow System. Notes and To-Dos follow too.",
      "Tavora follows your system's light or dark setting, or stays in the one you choose under Appearance.",
      "Bring your Steam games in one go: paste your profile link, tick the games you want, and Tavora can remember the profile on your PC.",
      "Settings has a Modules page that lists every module and where it came from, with Open folder and Reload, and a Diagnostic info button that copies what you need to ask for help. Nothing is sent anywhere.",
      "Modules can bring their own icon. Panel tabs and the module lists show it, and Settings has a switch for the icons on tabs.",
      "More games get their own icon: from the installed game, from the icon Steam shows for it, or from Steam's small icon. Icons fill their tile and sit on a backdrop that contrasts with them.",
      "A tidier sidebar: folders look like folders and show the games inside, an open folder is one panel, and a folder you drag a game into keeps its state. Hovering a game shows its name in a large, readable label. A long list fades out at the edge with an arrow to scroll instead of a scrollbar.",
      "A new game's empty workspace asks you to choose a layout first, and each pane has its own Add module button.",
      "To-Do groups can be given a color from the group's ... menu. Dragging a tab onto another tab shows a gold bar where it will land.",
      "Smaller fixes and behind-the-scenes improvements.",
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