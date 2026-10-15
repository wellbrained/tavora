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
    version: "0.5.26",
    date: "2026-10-16",
    title: "A clearer drop mark for tabs",
    notes: ["When you drag a tab onto another tab, a gold bar shows at the start or the end of that tab, where yours would land, instead of tinting half of it."],
  },
  {
    version: "0.5.25",
    date: "2026-10-16",
    title: "Behind the scenes",
    notes: ["Nothing changes for players. A test of Browser tabs now counts the tabs correctly."],
  },
  {
    version: "0.5.24",
    date: "2026-10-16",
    title: "A calmer game list",
    notes: [
      "With many games the sidebar no longer shows a scrollbar. The list fades out at the edge and a small arrow shows that there are more games; press it to scroll down.",
    ],
  },
  {
    version: "0.5.23",
    date: "2026-10-16",
    title: "Behind the scenes",
    notes: ["Nothing changes for players. Testing tools now build the app first when it is missing."],
  },
  {
    version: "0.5.22",
    date: "2026-10-16",
    title: "Volume and mute for each person in Discord",
    notes: [
      "Right-click a person in your voice channel, or press the … button next to their name, to set how loud they are (0 to 200%) or mute them for yourself only. It is the same setting as in Discord's own menu.",
      "A person you muted shows a speaker-off icon, and a person whose volume you changed shows a small speaker with the percentage.",
      "After you press Leave, you disappear from the list at once instead of after a few seconds.",
    ],
  },
  {
    version: "0.5.21",
    date: "2026-10-16",
    title: "Your own module icons",
    notes: [
      "A module can bring its own icon (the icon line in its tavora.module.json, a PNG or WebP). It shows on the panel tab, in Add module and in Settings > Modules.",
      "Modules without an icon show a puzzle piece instead of a letter.",
    ],
  },
  {
    version: "0.5.20",
    date: "2026-10-16",
    title: "Discord panel: a steady channel order and a smaller header",
    notes: [
      "The voice channels stay in the same order as on the Discord server. The channel you are in is highlighted where it is, and no longer moves to the top.",
      "Mute, Deafen, Leave and Rejoin sit in the header next to the server name, so the panel has more room for the channels.",
      "The hint that you are not in a voice channel is a note at the bottom of the panel, above the server setting.",
    ],
  },
  {
    version: "0.5.19",
    date: "2026-10-16",
    title: "Icons switch explained",
    notes: [
      "The Icons on panel tabs switch now says that the module lists always show the icons.",
    ],
  },
  {
    version: "0.5.18",
    date: "2026-10-16",
    title: "More module icons",
    notes: [
      "UI Playground shows the shadcn/ui logo, and the React, Vue and Vanilla example modules show the React, Vue and JavaScript logos.",
    ],
  },
  {
    version: "0.5.17",
    date: "2026-10-16",
    title: "Module icons in the library",
    notes: [
      "Add module and Settings > Modules show the module icons too. They are always shown there; the Icons on panel tabs switch only affects the tabs.",
    ],
  },
  {
    version: "0.5.16",
    date: "2026-10-15",
    title: "Browser tabs",
    notes: [
      "Open more pages at once: press + in the Browser toolbar or Ctrl+T for a new tab next to the one you're in.",
      "Links that want a new window now open in a new tab beside the page. Middle-click opens one without leaving the page you're on.",
      "Ctrl+W closes the Browser tab you're in.",
    ],
  },
  {
    version: "0.5.15",
    date: "2026-10-16",
    title: "Clearer Discord panel text",
    notes: ["When you are not in a voice channel, the Discord panel now says what to do next: press a channel in the list, or choose a server for the game to see its channels."],
  },
  {
    version: "0.5.14",
    date: "2026-10-16",
    title: "Icons on panel tabs",
    notes: [
      "Panel tabs show a small icon in front of the module name: the Discord logo for Discord, and plain icons for the Browser, Notes and To-Dos.",
      "Settings > Appearance has a switch, Icons on panel tabs, to turn them off.",
    ],
  },
  {
    version: "0.5.13",
    date: "2026-10-15",
    title: "Discord panel fixes",
    notes: [
      "The server's name shows once, in the header.",
      "Rejoin is in the bar at the top, where Leave is while you are in a channel.",
      "After you press Leave, the panel shows right away that you are out of the channel.",
      "Choosing a server for a game opens a list with a search field.",
    ],
  },
  {
    version: "0.5.12",
    date: "2026-10-15",
    title: "Discord for each game, and leave and mute",
    notes: [
      "The Discord panel can remember a server for each game. Tick Remember the server on this game, and switching to that game shows the server's voice channels and who is in them, even when you are not in a call. Choose any server you are on from the list.",
      "The channel list is read again every 5 minutes. The round arrow reads it now.",
      "New buttons while you are in a call: Mute, Deafen and Leave. Discord asks once to let Tavora mute you; the panel shows Allow muting until you do.",
      "Settings has Integrations now, with Discord and Steam as its first parts.",
    ],
  },
  {
    version: "0.5.11",
    date: "2026-10-15",
    title: "German for Notes and To-Dos, and a language list",
    notes: [
      "Notes and To-Dos speak German too, and change language the moment you do. Modules can ask Tavora which language to use.",
      "The language in Settings is now a list with a search field on top, so more languages fit later.",
    ],
  },
  {
    version: "0.5.10",
    date: "2026-10-15",
    title: "Join your Discord voice channel again",
    notes: [
      "The Discord panel remembers the voice channel you were last in. When you are not in one, press Rejoin to go back to it.",
      "Press any of the server's other voice channels in the list to join it.",
      "Joining is the only thing Tavora does in Discord. It still can't hear, talk or read messages.",
    ],
  },
  {
    version: "0.5.9",
    date: "2026-10-15",
    title: "Who's in your Discord voice channel",
    notes: [
      "New Discord module: see who is in your voice channel, who is talking and who is muted, without leaving your game. Find it under Add module.",
      "It follows you when you switch channels, works on any server and in calls, and lists the server's other voice channels too.",
      "You keep talking in the Discord app as usual. Tavora only reads your voice channel: it can't hear, talk, read messages or change anything.",
      "Connect it under Settings, then Discord. For now this needs the Client Secret of Tavora's Discord application.",
    ],
  },
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