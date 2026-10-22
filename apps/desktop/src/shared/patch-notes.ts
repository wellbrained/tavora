/**
 * What changed in each version, newest first. Shown when the version at the bottom
 * of the Settings sections list is pressed (it is not a menu item).
 * Entries are added when a pull request merges, from its change note in
 * apps/desktop/changes/ (the Number workflow); a test keeps them in step with
 * apps/desktop/package.json. Write for players, in plain friendly words. At 1.0 these
 * entries are replaced by a "1.0 release catalog" of all features, and a fresh
 * changelog starts (the decision log).
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
    version: "0.20.7",
    date: "2026-10-22",
    title: "Fewer antivirus alarms and a better calculator",
    notes: [
      "Tavora now spots your running games by itself, without starting PowerShell in the background. Some antivirus apps, like Norton, flagged that.",
      "Calculator: new keys √, x², ± and ans for your last result, with the Windows shortcuts @, q and F9. Big numbers show their thousands, like 1,234,567.",
      "Calculator: copy puts the result on your clipboard as a plain number, also with Ctrl+C.",
      "Calculator: a toolbar on top switches between the Basic keypad and Plus, and shows or hides your history. The keys keep a size you can press, in small panels too.",
      "Modules can remember files you choose and reread them without asking you to find them again. File access stays read-only, belongs to that module and game, and stays on this PC.",
      "In a small window, Settings > Modules wraps its buttons instead of running off the side.",
      "The publish screen shows your module's name while it packs.",
    ],
  },
  {
    version: "0.20.0",
    date: "2026-10-22",
    title: "Module catalog, cloud copy and more",
    notes: [
      "Browse Tavora's module catalog and install a module with one press. Each module has its own page with screenshots, what's new, who made it and what it can reach.",
      "Catalog modules update themselves while Tavora runs. An update that wants to reach new websites waits for your yes.",
      "Rate modules with 1 to 5 stars and a review, and sort the catalog by name, rating or newest.",
      "Something wrong with a module? Report it from the catalog or Settings > Modules. Tavora can stop a harmful module and keeps its data.",
      "New modules: Calculator, Clock & Counter with OBS overlays and hotkeys, and Enshrouded skill builds.",
      "Cloud copy: your games, panels and modules stay the same on every PC you sign in on. It's encrypted with your own recovery key, on our server or in your own OneDrive, Dropbox or Google Drive folder.",
      "On a new PC, get your recovery key from your other PC instead of typing it in.",
      "Tavora spots your running games: a green dot in the rail, and a button at the bottom of the rail to jump in.",
      "Personal workspaces: a place on the rail for Notes, Whiteboard, To-Dos and the like, without a game.",
      "Games open all at once behind one loader, and your rail stays in the order you chose.",
      "Settings is roomier and fits small windows. Buttons, fields and switches in the app match the module panels.",
      "For module developers: saving your developer name sets up publishing, and Publish next to your module uploads it with one click. Lost a publisher key? Press Lost it? in Settings.",
    ],
  },
  {
    version: "0.18.0",
    date: "2026-10-18",
    title: "Modules from other people",
    notes: [
      "Modules from other people: install a module someone sent you with Settings > Modules > Install from zip. It shows who made it, \"by …\", once its developer has linked their key to their Tavora account. An update is a newer zip from the same developer and keeps your data; a zip with the same or an older version, or from someone else, is refused with a message that says why.",
      "A module can say which Tavora it needs. If yours is older, installing it says which version to update to instead of installing something that would not work.",
      "The module library (Add module) is roomier: the same size as Settings, with compact rows, search that stays in view, a switch between all modules, those in this game and those not added yet, and counts and Add another for what is already open. It lists only the modules made for the game you are in.",
      "Modules can offer several panels, such as an inventory and a build planner, each with its own Add. Every panel can show something different, such as a different build, and keeps it when you switch games or restart. A panel can open another one on what it shows, and saves your changes before it switches. Tabs show a short name, and hovering one shows the full one.",
      "Menus of modules open above everything, drawn by Tavora in your theme, so they are never cut off in a narrow panel. Right-click a To-Dos group's header for its menu.",
      "A click in a module that opens a link, a menu or a Discord action no longer gets refused now and then.",
      "Whiteboard: drag a pasted or dropped picture into place right away, and lock or unlock each picture with the lock on its corner. Save as image saves the selection or the whole board as a PNG in Pictures\\Tavora; Clear board empties it, and Undo brings it back. The style palette can be moved or folded away, has ten quick colours and keeps the rarer options under More options, and the toolbar can sit at the bottom.",
      "For module developers: Settings > Development loads modules straight from their project folders, or from the folder you keep all your projects in, and reloads them on every build. Settings > Account has a Module developer part for your public name and linking your publisher key. Start a module with npm create @tavora/module; the docs are at docs.mytavora.app.",
    ],
  },
  {
    version: "0.17.6",
    date: "2026-10-17",
    title: "Separate development state and clearer startup errors",
    notes: [
      "Development runs keep their own games, settings and module data, separate from installed Tavora.",
      "If Tavora can't start, it now tells you why in a message instead of closing without a word, and writes a small log you can send to whoever helps you.",
    ],
  },
  {
    version: "0.17.4",
    date: "2026-10-17",
    title: "Tavora starts again",
    notes: ["0.17.3 closed itself right away on every start, before a window opened. Tavora starts normally again."],
  },
  {
    version: "0.17.3",
    date: "2026-10-17",
    title: "To-Dos reworked, and safer accounts",
    notes: [
      "To-dos can have sub-to-dos, up to four levels deep. While editing a to-do, Tab makes it a sub-to-do of the one above and Shift+Tab moves it back up a level. Tab works the same in a group's add row, so you can type a whole list with its sub-to-dos in one go. A to-do with sub-to-dos shows how many are done and folds them away with its little arrow.",
      "Click a to-do's title to edit it right where it is. Enter saves, Esc cancels. The row stays exactly as it is while you type, and no panel opens underneath.",
      "Descriptions are written from the ⋯ menu (Add description) in a small box that floats over the list. Ctrl+Enter or clicking outside saves, Esc cancels. The first line shows in grey under the title.",
      "To-do rows line up exactly: checkbox, title, pin and ⋯ share one line.",
      "Finishing a to-do finishes its sub-to-dos too, and a toast lets you undo it. Deleting a to-do can be undone the same way.",
      "A bar at the top of To-Dos holds the controls: how many to-dos are open, folding all groups at once, and whether finished to-dos stay in the list or vanish smoothly. Vanishing waits a moment, then the row slides away instead of the list jumping.",
      "Steps are now sub-to-dos, and a to-do's source link moved into its description. Nothing you wrote is lost.",
      "Removing the email from your Tavora account, and connecting or disconnecting Discord, now ask for a code sent to your email. Someone who got hold of your sign-in can no longer quietly take your account, and you can always remove a Discord login, even one you can no longer sign in to.",
      "A module can mute, unmute or deafen you in Discord only right after you click in its panel, like joining a channel.",
      "One click on a web page opens at most one new Browser tab, and pages on the internet can no longer reach your router or other devices by their local names.",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-10-17",
    title: "Sign in with Discord, and modules that ask first",
    notes: [
      "Sign in with Discord: Settings > Account lets you sign in with Discord in your browser, no email needed. Signed in, you can connect Discord to your account as a second way in, add or remove your email, and see both under Sign-in methods. Tavora keeps only your Discord user id and username, never a Discord token, and never links accounts by themselves.",
      "Modules work in a new way: you decide what each one may reach. A module that wants to reach websites asks you the first time you add it, and shows which websites and who made it. Tavora makes every request for it, so a module never gets your cookies or sign-ins. If an update of a module wants more, it keeps working as before and its panels show a Review bar until you decide.",
      "Settings > Integrations lists what each module may reach. Take it back there at any time: Tavora first tells you which games use the module, then removes its panels. Its data stays. Removing a module in Settings > Modules works the same way.",
      "Discord is now its own module, like Notes and To-Dos. The first time you open it, Tavora asks whether it may use Discord with Tavora's sign-in; the module never sees the sign-in. Everything works as before: your voice channel, who is talking, joining and leaving, muting, each person's volume and the server each game remembers. You don't need to sign in again.",
      "AI Usage is now its own module too. Tavora reads your Claude and Codex accounts and hands the module only the answer, never your logins. Press the cog in the AI Usage panel to put your accounts in your own order and choose % left or % used and how often it refreshes. Claude accounts now show who is signed in when you point at the name. Your settings and last readings come along.",
      "Tavora's program, taskbar button and shortcuts show the Tavora flame instead of the Electron logo.",
      "Creating a Tavora account asks you to confirm that you are 16 or older, or at least 13 with your parent's permission. Tavora keeps nothing about your age.",
    ],
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
