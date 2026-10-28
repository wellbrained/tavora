# Overlay setups (steps 1 to 3 built)

Decided with the owner on 2026-10-27. Replaces the separate Overlay layout window (see [overlay-layout.md](overlay-layout.md) for how the page works now); the per-game overrides are gone since step 1. It uses the names from the [Game → Workspace rename](workspace-rename.md), which is done.

## Setups

An overlay setup is a saved overlay layout: which items show, where, and how each one is set (mode, opacity, hotkey, Hide from capture).

| Setup | Exists | Shows when |
|---|---|---|
| Everywhere | always | always, over any app, except while Tavora's own window is in front |
| All games | always | a game is in front that has no setup of its own |
| One per game workspace | added by the user | that game is in front |

- On screen: Everywhere, plus either the game's own setup or All games. Game setups stand alone; they never stack with All games.
- A game setup is added by right-clicking the workspace on the rail ("Add overlay" / "Overlay hinzufügen") only (not from the Overlay page); removed with "Remove overlay" / "Overlay entfernen". Removing a workspace removes its setup.
- Up to 8 items per setup.
- Per-game overrides of general positions ("Customize for this game", "Follow All games") go away.
- Nested setups (a "Basic" setup inside a game setup) are dropped for now and kept only as a loose idea.

## Items and sources

An item is an existing panel from some workspace, or a module overlay (`overlay.showOverGame`). It is the same panel as in its workspace, never a copy; closing the panel in its workspace removes it from every setup. One panel can be in several setups, with its own position and settings in each.

- Panels from a personal workspace can go into any setup.
- Panels from a game workspace (game modules and general modules such as Notes alike) can only go into that game's setup.
- Module overlays land in their game's setup (created if missing), or in All games when they come from a personal workspace. Personal items can move between Everywhere and All games.

## Overlay page

A page in the main window that works like a workspace (no entry on the rail; only the header's Overlay button opens it, and it stays there, lit); the separate Overlay layout window goes away. The layout is fixed: the canvas and the sidebar, which sits on the left or the right as set in Settings > Overlays.

- First in the toolbar above the canvas (not in the header): the setup dropdown. It opens on the running game's setup, else All games while a game runs, else Everywhere.
- Canvas: game setups keep Take picture from the running game; Everywhere and All games use a plain screen-sized area.
- Sidebar, two stacked panels:
  - Sources, with search: every panel from every workspace, its source named ("Notes · Satisfactory"). Ones that can't go into the chosen setup are greyed out with the reason and folded together at the bottom ("Can't be used here"). A click adds one; a click on one already in the setup selects it.
  - Settings of the selected item (picked in the list or on the canvas), its name at the top right, sized to its content; Show (Always on / On a key, with a line saying what it does), Key, Opacity, Hide from capture (with a line saying what it does), then Reset position / Reset size, Preview / Move, and a red Remove; a short hint when nothing is selected.

## Header

The header is the workspace's own header on the Overlay page too, with every button in the same place (the ones for a workspace, Layouts and Add module, are dimmed there). A two-part button in it, next to Layouts:

- **Overlay** opens the Overlay page.
- **Start / Stop** (the right part of the button, text and icon) starts and stops overlays. Overlays are stopped whenever Tavora starts; the user starts them. There is no Pause state. Running, it is green while something shows and blue while it waits for a game. Its tooltip says what a click does.

The button is hidden while overlays are off in Settings. Main sends a new live state to the renderer for it; today's `GameOverlaysView` has none.

## Settings and runtime

- Settings > Overlays keeps only the on/off switch and the global options (Keep when you switch windows, the layer key).
- The layer key works whenever something shows, including Everywhere over the desktop; Esc closes it.
- Everywhere showing outside games is a new reach for module pages: the [security model](../../apps/docs/guide/security.md) is updated in the same pull request.

## Moving today's data

- General items (from personal workspaces) go to All games.
- A game's own items go to a new setup for that game.
- Customized per-game positions of general items are lost; the patch note says so.
- Nothing starts showing in a new place after the update.

Built in step 1 (decided with the owner on 2026-10-27 while building): each new game setup also gets copies of the general items at their All games place, up to 8 with the game's own items first, so nothing stops showing over a game that had both. Only the customized per-game places are lost.

## How step 1 is built

`game-overlays.json` version 5 holds `setups` (`$everywhere`, `$all`, and one per game workspace id, in `game-overlays.ts`). Choices made while building, not covered above:

- **The move.** A file of version 4 or older is read with its old limits, moved in memory and written at start. The old file is first copied to `backups/before-overlay-setups/`; if that copy fails, the store goes read-only for the session and never writes over the old file. Until the first write, a restart redoes the same move from the same file. Older Tavora versions can't read version 5 and set the file aside.
- **Hotkeys stay per item.** One toggle key per overlay or panel, working in every setup it is in; `hotkeys.json` is unchanged.
- **One window per item.** An item in Everywhere and in the game-side setup on screen shows once, as the game-side setup has it.
- **Everywhere sits on the main screen**, in units of its height, like game-side items on the game window.
- **Tavora in front** means one of Tavora's own windows (not an overlay or the veil) has the focus.
- **A new game setup starts with copies of All games' items**, leaving one slot for the item that made it, so the game shows what it showed before. A setup made by a failed show is removed again. An empty game setup is kept until its workspace or Remove overlay removes it.
- **Where things land.** `overlay.showOverGame` and Show in game land in the item's game setup or All games (`landingSetup`); "exists" when the item is in any setup already. Putting personal items into Everywhere comes with the Overlay page (step 2).
## How step 2 is built

The Overlay page is `renderer/pages/OverlayPage.vue`, shown by a third screen (`Screen = "overlay"`) in the main window, opened by the `open-overlay-page` action. Choices made while building, not covered above:

- **No window of its own.** The live pages and the layer sit as native views over the page's canvas area (`main/overlay-canvas.ts`, the old window's code without the window); leaving the page (a workspace on the rail, Home, or the lit Overlay button) takes them away. The state stays `overlay-layout.ts`; the saved window place is gone from `game-overlays.json` (an older file's is ignored).
- **Opens on** the setup asked for, else the running game's own, else All games while a game runs, else Everywhere. The dropdown always lists Everywhere and All games, then the games with a setup. Add overlay and Remove overlay are on the rail only.
- **Sources list.** Besides every panel of every workspace, it lists the module overlays the setup already holds (they have no other place in the list, and the user selects and hides them there). Reasons shown for a panel that can't be added: only for its game, can't show over a game (its type isn't `inGame`), no room left (8 items). The eye still hides an item on the canvas only.
- **Moving between Everywhere and All games** is a button in the Settings panel for items from personal workspaces: the item goes with its place and settings; if the other setup has it already, that one stays and this one is dropped.
- **Hotkey dialog** is the main window's one now (the old window asked for its own).
- Leaving goes to the last workspace, else Home.
- **Rail menu** of a game workspace: Add overlay / Remove overlay (hidden while overlays are off in Settings); removing the setup closes its windows at once.

## Steps

0. [Game → Workspace rename](workspace-rename.md) (done).
1. Setups in the data, the which-setup-shows rule, the source rules, the limit, showing outside games, the data move, the security page (done).
2. The Overlay page; Add overlay / Remove overlay on the workspace (done).
3. The header button and the live state; Settings trimmed (done, built before step 1 and 2).

Each step adds a patch note; the last one raises the minor version once the owner calls the feature complete.
