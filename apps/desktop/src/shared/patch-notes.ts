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
    version: "0.19.38",
    date: "2026-10-22",
    title: "One loader when Tavora starts",
    notes: [
      "When Tavora opens your last game, one loader covers all its panels until they're ready, instead of a loader in every panel.",
      "Your panels start loading together with Tavora, so they show up sooner.",
      "Enshrouded Builds shows your skill tree faster.",
    ],
  },
  {
    version: "0.19.37",
    date: "2026-10-22",
    title: "No setup card while Tavora checks",
    notes: [
      "Settings > Modules > Development shows \"Want to make modules?\" only once Tavora knows publishing isn't set up. No more flash after a start, and it stays away while you're offline.",
      "Publish and Save as zip check your setup first when Tavora doesn't know it yet.",
    ],
  },
  {
    version: "0.19.36",
    date: "2026-10-22",
    title: "Publishing lives in Tavora",
    notes: [
      "Tavora no longer signs for tavora-pack, so there's no Allow prompt any more. Press Publish in Settings > Development instead.",
      "To publish from CI, export your key under Publisher keys and CI and pass it to tavora-pack with --key.",
    ],
  },
  {
    version: "0.19.35",
    date: "2026-10-22",
    title: "Project rows",
    notes: [
      "A project that isn't built yet looks like the others in Settings > Development, with its name and version.",
      "Every project there has an Open folder button.",
    ],
  },
  {
    version: "0.19.34",
    date: "2026-10-22",
    title: "Simpler developer settings",
    notes: [
      "Saving your developer name now sets up publishing: Tavora makes your publisher key and claims your prefix.",
      "Settings > Development shows just your name and prefix. Keys, key files and tokens sit under Publisher keys and CI.",
      "Each publisher key shows once, with Export, Lost it? and Unlink.",
      "Make modules no longer asks for a prefix you already have.",
      "Signing in on a new PC asks for your account's recovery key right away, if your account has one.",
      "The texts for your developer name, prefix, publisher key and recovery key now explain what each is for.",
    ],
  },
  {
    version: "0.19.33",
    date: "2026-10-22",
    title: "Publishing stays set up",
    notes: [
      "\"Want to make modules?\" no longer shows up in Settings > Development after a restart once publishing is set up.",
      "Publish and Save as zip work right after a start, without opening Settings > Account first.",
    ],
  },
  {
    version: "0.19.32",
    date: "2026-10-22",
    title: "Clock & Counter works without OBS",
    notes: [
      "Adding Clock & Counter no longer asks about stream overlays.",
      "You're asked the first time you copy an OBS link, and the module works either way.",
    ],
  },
  {
    version: "0.19.31",
    date: "2026-10-22",
    title: "Clock & Counter",
    notes: [
      "New module: countdowns, stopwatches and counters for each game.",
      "Pick how a clock shows its time, with or without hours.",
      "Counters can add to each other, like 5 sit-ups per death.",
      "Show any of them in OBS with its own link, and control them with hotkeys.",
    ],
  },
  {
    version: "0.19.30",
    date: "2026-10-21",
    title: "Examples and project folders",
    notes: [
      "Settings > Development lists each project folder with its modules under it, so a module shows up only once.",
      "The examples that ship with Tavora have their own list. Open one's folder to read the code, or make a copy to start your own module.",
      "The UI Playground is listed with the other official modules now.",
    ],
  },
  {
    version: "0.19.29",
    date: "2026-10-21",
    title: "Publish modules from Tavora",
    notes: [
      "New to making modules? Want to make modules? in Settings > Development walks you from sign-in to your first project.",
      "Check and claim your prefix right in Tavora.",
      "Publish next to your module shows what goes out, sets the version and notes for you, and uploads it with one click.",
      "Save as zip packs a module to share by hand.",
      "Your developer name, keys and publish tokens moved to Settings > Development.",
    ],
  },
  {
    version: "0.19.28",
    date: "2026-10-21",
    title: "Rate modules",
    notes: [
      "Catalog cards show a module's rating and how many rated it. Click the arrow to see how many gave each star.",
      "Rate a module you installed with 1 to 5 stars and an optional review, on its page. You need to be signed in.",
      "Developers can reply once under each review of their module.",
      "Sort the catalog by name, rating or newest.",
    ],
  },
  {
    version: "0.19.27",
    date: "2026-10-21",
    title: "Clearer module warnings",
    notes: [
      "Modules that cannot load now have their own space in Settings, with readable paths and an Open folder button for each warning.",
    ],
  },
  {
    version: "0.19.26",
    date: "2026-10-21",
    title: "Stream overlays and hotkeys",
    notes: [
      "Turn on Stream overlays in Settings > Streaming, and modules can show their overlays in OBS.",
      "Modules can offer hotkeys. You pick the keys in Tavora, and they work while the game is open here.",
      "Settings > Streaming lists every hotkey, so you can remove any of them.",
    ],
  },
  {
    version: "0.19.25",
    date: "2026-10-21",
    title: "Patch notes in their own window",
    notes: [
      "A module's patch notes in Settings > Modules open in a window instead of under the module.",
      "Module library in Settings > Modules opens the library on Tavora's catalog.",
    ],
  },
  {
    version: "0.19.24",
    date: "2026-10-21",
    title: "Developer links work again",
    notes: [
      "Docs, Ask a question and Report a bug in Settings > Development open their pages again.",
    ],
  },
  {
    version: "0.19.23",
    date: "2026-10-21",
    title: "Browse shows every module",
    notes: [
      "Browse lists every module in the catalog. The ones for your game come first.",
      "Modules for another game say which one, and Install waits until you open it.",
      "Cards show how often a module was installed. Size, access and Report moved to its page.",
      "A module's page says plainly which sites it loads data from.",
    ],
  },
  {
    version: "0.19.22",
    date: "2026-10-20",
    title: "Your rail stays put",
    notes: [
      "Picking a game no longer moves it on the rail.",
      "\"Recently played\" now sorts your games when Tavora starts.",
    ],
  },
  {
    version: "0.19.21",
    date: "2026-10-20",
    title: "One look for the app and modules",
    notes: [
      "Buttons, fields and switches in the app now match the module panels.",
      "Screen readers say \"Close\" in your language in every dialog.",
    ],
  },
  {
    version: "0.19.20",
    date: "2026-10-20",
    title: "Enshrouded skill cards",
    notes: [
      "Build bonuses stay on the right; use the toggle to give the tree more room.",
      "Hover or focus a skill for a game-style card with its effects, rank and point cost.",
    ],
  },
  {
    version: "0.19.19",
    date: "2026-10-20",
    title: "Enshrouded build bonuses",
    notes: [
      "Open Build bonuses to see what your chosen skills grant at their current ranks.",
      "Class names sit clear of the outer skill branches.",
    ],
  },
  {
    version: "0.19.18",
    date: "2026-10-20",
    title: "Enshrouded build planning",
    notes: [
      "Skill icons have room around them when you zoom in.",
      "Build dialogs, buttons and the build picker follow your Tavora theme.",
    ],
  },
  {
    version: "0.19.17",
    date: "2026-10-20",
    title: "Enshrouded skill builds",
    notes: [
      "Plan and save Enshrouded 1.0 skill builds in a separate module.",
      "Modules can export JSON files to Downloads/Tavora when you click Export; existing files are kept.",
    ],
  },
  {
    version: "0.19.16",
    date: "2026-10-20",
    title: "Settings fit small windows",
    notes: [
      "In a small window, Settings moves buttons and switches under their text instead of squeezing it.",
    ],
  },
  {
    version: "0.19.15",
    date: "2026-10-20",
    title: "Lost a publisher key?",
    notes: [
      "Module developers: lost or leaked a publisher key? Press Lost it? next to it in Settings > Account. No email needed.",
      "Your modules move to your newest key once Tavora checks it.",
    ],
  },
  {
    version: "0.19.14",
    date: "2026-10-20",
    title: "Add a PC from your other PC",
    notes: [
      "On a new PC, get your recovery key from your other PC instead of typing it in.",
      "Both PCs show the same code. Check it, then click Add on your other PC.",
      "Works with your own cloud copy folder too, no account needed.",
    ],
  },
  {
    version: "0.19.13",
    date: "2026-10-20",
    title: "Publishing needs your account",
    notes: [
      "Module developers: your publisher key alone can't publish any more. Tavora uploads for tavora-pack with your sign-in.",
      "To publish from CI, make a publish token under Settings > Account.",
      "You get an email every time a module of yours is published.",
    ],
  },
  {
    version: "0.19.12",
    date: "2026-10-20",
    title: "Tavora keeps your publisher keys",
    notes: [
      "Module developers: make a publisher key under Settings > Account. Your recovery key keeps it safe, so there's no key file to back up.",
      "tavora-pack asks Tavora to sign, and Tavora asks you first.",
      "Export a key to publish from CI.",
      "Your recovery key has its own place in Settings > Account.",
    ],
  },
  {
    version: "0.19.11",
    date: "2026-10-20",
    title: "Cloud copy in your own folder",
    notes: [
      "Keep your cloud copy in a folder of your own, like your OneDrive, Dropbox or Google Drive. No account needed.",
      "It's encrypted on your PC, just like on our server.",
    ],
  },
  {
    version: "0.19.10",
    date: "2026-10-20",
    title: "One recovery key for your account",
    notes: [
      "Your recovery key now belongs to your account. Turning the cloud copy off and on again no longer asks for it.",
      "Lost your key? Start over with a new one, right where Tavora asks for it.",
    ],
  },
  {
    version: "0.19.8",
    date: "2026-10-19",
    title: "Tidier module library",
    notes: ["Modules with several panels keep their card small. Click the arrow next to Add all to pick one."],
  },
  {
    version: "0.19.7",
    date: "2026-10-19",
    title: "A button for the game you're playing",
    notes: [
      "When one of your games is running, a controller shows up at the bottom of the rail. Hover to see which game, click to jump in.",
      "It works for games inside folders too.",
    ],
  },
  {
    version: "0.19.6",
    date: "2026-10-19",
    title: "Cloud copy",
    notes: [
      "New in Settings > Account: turn on the cloud copy, and your games, panels, modules and their data stay the same on every PC you sign in on.",
      "It's encrypted on your PC with your own recovery key, so only you can read it. Keep the key safe: you need it on your other PCs.",
      "Tavora picks up newer data when it starts, uploads your changes every few minutes and once more when you close it. If both PCs changed, you choose which to keep, and the other is saved as a local backup.",
    ],
  },
  {
    version: "0.19.5",
    date: "2026-10-19",
    title: "Tavora spots your games",
    notes: [
      "When one of your games starts, it gets a green dot in the rail. Click it to jump in.",
      "Rather switch right away or be asked? Pick it under Settings > General, \"When a game starts\".",
      "Tavora can also take you back to a personal workspace when the game closes.",
    ],
  },
  {
    version: "0.19.4",
    date: "2026-10-19",
    title: "Favorites get their full menu",
    notes: ["Right-click a favorite to change its icon, rename it or remove it again."],
  },
  {
    version: "0.19.3",
    date: "2026-10-19",
    title: "Import public guide pages",
    notes: [
      "Modules can read public pages in a hidden temporary browser when a website needs it to load. It uses only websites you allowed and keeps your browser sign-ins private.",
      "Page imports stop if sign-in or verification is needed, and close when their panel closes.",
    ],
  },
  {
    version: "0.19.2",
    date: "2026-10-19",
    title: "Clearer module problems",
    notes: [
      "A module that can't load now shows its folder in Settings > Modules, with a button to open it and what to do next.",
    ],
  },
  {
    version: "0.19.1",
    date: "2026-10-19",
    title: "Share icons of your own games",
    notes: [
      "Sharing game icons now needs you to be signed in.",
      "You can share icons of games you added by name too.",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-10-19",
    title: "The module catalog",
    notes: [
      "Browse Tavora's module catalog in the module library and install a module with one press. Each module has its own page with screenshots, what's new, who made it and what it can reach. Tavora checks every download against its listing and its publisher's signature.",
      "Modules from the catalog update themselves while Tavora runs, with no restart. An update that wants to reach new websites waits for your yes, and the version you have keeps running until then.",
      "Something wrong with a module? Report it from the catalog or Settings > Modules. A person at Tavora looks at every report, and it says nothing about you.",
      "Tavora can stop a harmful module that's already installed. It says why in Settings > Modules and keeps the module's data.",
      "Modules have their own patch notes, next to each one in Settings > Modules.",
      "Personal workspaces: a place on the rail that belongs to no game, for Notes, Whiteboard, To-Dos and the like. Pick Make a personal workspace instead under Add game.",
      "Right-click a panel and pick Remove from game to take its module out of just this game. Its data comes back when you add it again.",
      "Games open all at once: a campfire covers the workspace until every panel has loaded.",
      "Settings is roomier, with new Online and About pages, short texts and red buttons for anything that removes. Pictures from modules now live in Pictures\\Tavora.",
      "Settings > Games lets you move many games to Trash at once, and Share icons can send icons for games you haven't added.",
      "Item tooltips can open over neighbouring panels. Click to pin them, press Escape to close.",
      "To-Dos menus stay open while your changes save.",
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
