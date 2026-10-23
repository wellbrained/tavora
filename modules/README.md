# Official modules

Notes, To-Dos, the Whiteboard, Clock & Counter, the Calculator and the UI Playground ship with Tavora and are shown as
**Official**. They are ordinary modules: a `tavora.module.json`, a Vite build
in `dist/`, and only the public [`@tavora/sdk`](../packages/sdk/README.md) to talk to the host. A
community module could do everything they do.

| Folder | Module | What it stores |
| --- | --- | --- |
| `notes` | `tavora.notes` | One document per note, plus the `scratchpad` document every game has. Each holds the Tiptap JSON, its plain text (for search and the list), `pinned` and `createdAt`. The panel remembers which note it shows. |
| `todos` | `tavora.todos` | One `todos` document per game with groups and their tasks (title, details, pinned, sub-to-dos by `parentId`) in the order shown. Each panel remembers which groups and tasks are folded and whether finished to-dos stay or vanish. |
| `whiteboard` | `tavora.whiteboard` | One document per board (`board-…` ids that sort in the order the boards were made); its title is the board's name, its data the drawing's elements and background colour, without deleted elements. Built on Excalidraw (React, MIT) with the Mermaid import, the other translations and the Chinese fonts left out, and its fonts served from the module's own folder. Pictures (pasted, dropped or inserted) are kept in the module pictures folder (see Files in the protocol reference); the board stores only which stored file each picture uses (`files`), so boards stay small. A new picture stays free while it is selected, so it can be dragged into place, and is locked once it is let go of, so drawing on top does not move it. A lock on each picture's corner locks or unlocks just that one (a locked picture cannot be clicked in Excalidraw). Copy as image (header button or Shift+Alt+C) puts the selection, or the whole board, on the clipboard as a PNG with `clipboard.writeImage`; Save as image saves the same PNG in `Pictures\Tavora` with `pictures.save`, named after the board and the time. Clear board takes everything off the board, with Undo. The toolbar can sit at the top or the bottom (main menu; one choice for every game, in `storage.app`), the palette is compact with ten quick colours (a pnpm patch of Excalidraw's colour picks, `patches/`) and shows only its main options (the rest under More options, the Layers row hidden). Stored files no board uses and older than an hour are removed when a panel opens. Excalidraw's style palette gets a handle to drag it around the board or fold it away. Each panel remembers the board it shows, the view (scroll and zoom) of each board, and where its palette is. |
| `clock-counter` | `tavora.clock-counter` | One `items` document per game with every countdown, stopwatch and counter in the order shown. A running clock keeps when it started (`since`) and what it counted before (`counted`), so it keeps real time through restarts and saves only on start, pause, lap or reset; a counter keeps its value, step, goal and links (each step also adds a set amount to other counters, one level deep). Each item's overlay (key = item id, see Stream overlays in the protocol reference) gets the item's look and clock times from the panel that changed it, and counts a running clock itself. Hotkeys (manifest `actions`) arrive at the panel used last. Which item's settings are open is each panel's own. |
| `calculator` | `tavora.calculator` | No documents. The game's last 10 calculations (what was typed and the result, newest first) in that game's settings (`storage`, key `history`), so every panel of the game shares them. Sums are read by its own parser, never `eval`. |
| `discord` | `tavora.discord` | No documents. The channel to rejoin in its settings shared by every game (`storage.app`, key `last`), and the server a game remembers in that game's settings (`server`). Everything else comes live from the Discord app through Tavora's `discord` connector, which keeps the sign-in; the module asks for nothing but that connector. |
| `playground` | `tavora.playground` | Nothing. It shows every shared control (colours, type, buttons, fields, choices, tabs, badges, menus, dialogs, rows, notices) on its own, to try out the look and feel. Each panel remembers its filter and the Disabled switch. |
| `shared` | `@tavora/official-ui` | Not a module. Theme CSS, shadcn-vue components and the save helpers, bundled into the modules. The app builds its own controls from the same components, so there is one kit. |

## How they save

- Changes save on their own. Notes waits for a short pause in typing and also
  saves when another note is opened or the panel is hidden or closed.
- Several panels of one module share the same documents. A panel that saves
  after another panel did gets `CONFLICT` from the host; the change is then
  applied again to the newest copy (`updateDocument` in
  `shared/src/documents.ts`), so both panels keep their work. Changes are
  written so that running them twice gives the same result.
- The theme comes from `ui.getTheme`: `connectModule()` sets each token as a
  CSS variable, which `shared/src/theme.css` maps into Tailwind.

## Working on them

```sh
pnpm --filter ./modules/notes build      # or ./modules/todos, ./modules/playground
pnpm --filter @tavora/desktop start
```

Modules run from their built files. `pnpm dev` rebuilds them on every change;
with `start`, rebuild a module after changing it.

## One UI kit

`shared` is the only UI kit. The app and every official module take their
controls from it (`@tavora/official-ui/components/ui/…`); nobody keeps a copy
or starts another kit. Restyle a control with classes where it's used.

Need a control or variant the kit doesn't have? Talk it through with the
maintainer first. Once it's agreed, it goes in `shared/src/components` and gets
a specimen in the playground.

## Game modules live outside this repo

Game-specific modules are never part of this repo or the app: each has its own repo, the dev Tavora loads its local folder, and releases are published from the installed Tavora. This is a locked decision; see "Game modules" in the repo's `CLAUDE.md`. Satisfactory and PoE2 Builds still sit here until they are moved to their own repos; until then their `.standalone` marker keeps them out of the dev host's Official list.

## Catalog page

A module's `readme` (manifest) is the About text on its catalog page. Keep it short and for players: what the
module is and what it does for them, as the Writing rules in the repo's CLAUDE.md say. Build steps, data sources,
limits and licence notes go in the module's `README.md`. Satisfactory uses `ABOUT.md` for this.
