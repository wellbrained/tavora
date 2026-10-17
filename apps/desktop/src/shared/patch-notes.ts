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
    version: "0.16.12",
    date: "2026-10-17",
    title: "Tavora's own icon",
    notes: [
      "Tavora's program, taskbar button and shortcuts now show the Tavora flame instead of the Electron logo.",
    ],
  },
  {
    version: "0.16.11",
    date: "2026-10-17",
    title: "Discord is a module",
    notes: [
      "Discord is now a module like Notes and To-Dos. The first time you open it, Tavora asks whether it may use Discord with Tavora's sign-in. The module never sees the sign-in: Tavora keeps it and passes on only what Discord answers.",
      "Everything works as before: who is in your voice channel and who is talking, joining and leaving, muting, each person's volume and the server each game remembers. Your remembered servers and the channel to rejoin come along, and you don't need to sign in again.",
      "Settings > Integrations > Discord lists which modules may use Discord, and you can take it back there.",
    ],
  },
  {
    version: "0.16.10",
    date: "2026-10-17",
    title: "AI Usage is a module",
    notes: [
      "AI Usage is now a module like Notes and To-Dos. The first time you open it, Tavora asks whether it may read the usage of your AI accounts. It never sees your logins: Tavora reads each account and hands it only the answer.",
      "Put your accounts in the order you like: press the cog in the AI Usage panel. Whether it shows % left or % used and how often it refreshes moved there too, and they are the same in every game. Your settings and last readings come along.",
      "Claude accounts now show who is signed in when you point at the name, like Codex accounts already did.",
      "Settings > Integrations > AI usage lists which modules may read your accounts, and you can take it back there.",
    ],
  },
  {
    version: "0.16.9",
    date: "2026-10-17",
    title: "You decide what modules may reach",
    notes: [
      "A module that wants to reach websites now asks you the first time you add it, and shows which websites and who made it. Once you allow it, you can add it anywhere without being asked again. Cancel, and nothing is added.",
      "If an update of a module wants more, it keeps working as before and its panels show a Review bar until you decide.",
      "Settings > Integrations lists which modules may reach which websites. Take it back there at any time: Tavora first tells you which games use the module, then removes its panels and leaves an empty slot where nothing else was. Its data stays. Removing a module in Settings > Modules works the same way.",
    ],
  },
  {
    version: "0.16.8",
    date: "2026-10-17",
    title: "Groundwork for module permissions",
    notes: [
      "Behind the scenes, Tavora can now let a module reach websites you allowed for it, and only those, with Tavora making each request so the module never gets your cookies or sign-ins. Nothing changes for you yet: the dialog that asks you comes in the next version, and until then no module can reach the internet.",
    ],
  },
  {
    version: "0.16.7",
    date: "2026-10-17",
    title: "Sign in with Discord",
    notes: ["Settings > Account: sign in with Discord in your browser, no email needed. Signed in, you can connect Discord to your account as a second way in, add or remove your email, and see both under Sign-in methods. Tavora keeps only your Discord user id and username, never a Discord token, and never links accounts by themselves."],
  },
  {
    version: "0.16.6",
    date: "2026-10-16",
    title: "Minimum age for accounts",
    notes: ["Creating a Tavora account now asks you to confirm that you are 16 or older, or at least 13 with your parent's permission. Tavora keeps nothing about your age."],
  },
  {
    version: "0.16.5",
    date: "2026-10-16",
    title: "Tavora accounts and modules from a zip",
    notes: [
      "New, optional Tavora account in Settings > Account: enter your email, type in the 6-digit code Tavora sends you, and you are signed in. No password. A new address is asked once before an account is made. Tavora keeps working fully without an account, and everything stays on your PC.",
      "Signed in, your name, initials and picture go with your account to every PC you sign in on. The first time a PC has a different profile, Tavora asks which one to keep; after that the newest change wins.",
      "Settings > Account lists the PCs you are signed in on, and you can sign any of them out. You can change your email (with a code to the new address) or delete your account; deleting removes it from Tavora's service at once, and nothing on your PCs is touched.",
      "Install modules from a zip in Settings > Modules. Tavora checks the zip before it unpacks anything, and a module from someone else can never replace one you have or read its data, even with the same name. Modules signed by their maker show a publisher tag.",
      "What a module saves now belongs to whoever made it, not just to the module's name. Your existing notes, pictures, to-dos and module settings are moved over once at start; nothing changes for you. Data from modules you removed is listed in Settings > Modules, where you can delete it.",
    ],
  },
  {
    version: "0.15.0",
    date: "2026-10-16",
    title: "Whiteboard, pictures in Notes and AI Usage",
    notes: [
      "New Whiteboard module: draw, add shapes, arrows and text on as many boards of your own for each game as you like. Switch between them, rename them, or delete one with an Undo notice. It saves as you draw and works offline, in English and German, in light or dark.",
      "On the Whiteboard, paste a screenshot (Ctrl+V), drop a picture or use the image tool, and scribble on top of it. A new picture is locked so your drawing does not drag it around; the Unlock pictures button in the header lets you move or resize it. Copy as picture (or Shift+Alt+C) puts the board, or just what you selected, on the clipboard so you can paste it into Notes, Discord or any other app.",
      "Pictures in Notes: paste a screenshot, drop a picture file into a note, or use the Insert image button (PNG, JPEG, GIF, WebP). Put a picture on its own line as Small, Medium or Full width, or at the left or right with the text flowing around it. Drag its corner to resize it, open it larger, or remove it. Choose Optimized (smaller files) or Original under the Insert image button.",
      "Settings > Modules has a new Module pictures folder setting: keep the pictures of Notes and the Whiteboard on another drive. Tavora copies the pictures, checks them, and only then switches over. If the folder is not there when Tavora starts (an unplugged drive, say), you get a notice and nothing is deleted. Pictures that nothing uses any more are cleaned up.",
      "New AI Usage panel: it shows how much of your Claude and Codex subscription allowance is left for each of your accounts, with a bar for the 5-hour and weekly windows and a countdown to the reset. Add your accounts in Settings > Integrations > AI usage. Tavora never saves or shows your logins.",
      "Notes: give a note a title of your own (type it above the text, double-click the note in the list, or press F2), drag notes into your own order (Alt+Up and Alt+Down work too), and pick a font and size with the Aa button. The notes list can be dragged wider or collapsed to a strip of icons. The scratchpad has Save as note and Clear. Deleting a note now happens at once, with an Undo notice for 10 seconds.",
      "Links in Notes: click a link to see its address with Open, Edit and Remove. Ctrl+click opens it in your Browser panel (links show a hand cursor while you hold Ctrl). If the game has no Browser panel, Tavora asks whether to use a new one or your system browser.",
      "Discord no longer asks you to paste a Client Secret: press Connect and approve Tavora in Discord. For now Discord lets only approved testers of Tavora do this; if Discord refuses, ask to be added as a tester.",
      "Safer modules: a misbehaving module can no longer crash Tavora, and a module can keep at most 256 MB in its own browser storage for each game. A module can only open a link or copy a picture right after you click or press a key in it.",
      "Smaller fixes: folders in the sidebar no longer show a number badge, switching games no longer shows panels building themselves, headings in Notes use the theme's accent colour, and more.",
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