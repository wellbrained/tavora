# Official modules

Notes, To-Dos, the Whiteboard and the UI Playground ship with Tavora and are shown as
**Official**. They are ordinary modules: a `tavora.module.json`, a Vite build
in `dist/`, and only the public [`@tavora/sdk`](../packages/sdk/README.md) to talk to the host. A
community module could do everything they do.

| Folder | Module | What it stores |
| --- | --- | --- |
| `notes` | `tavora.notes` | One document per note, plus the `scratchpad` document every game has. Each holds the Tiptap JSON, its plain text (for search and the list), `pinned` and `createdAt`. The panel remembers which note it shows. |
| `todos` | `tavora.todos` | One `todos` document per game with groups and their tasks (title, details, pinned, sub-to-dos by `parentId`) in the order shown. Each panel remembers which groups and tasks are folded and whether finished to-dos stay or vanish. |
| `whiteboard` | `tavora.whiteboard` | One document per board (`board-…` ids that sort in the order the boards were made); its title is the board's name, its data the drawing's elements and background colour, without deleted elements. Built on Excalidraw (React, MIT) with the Mermaid import, the other translations and the Chinese fonts left out, and its fonts served from the module's own folder. Pictures (pasted, dropped or inserted) are kept in the module pictures folder (see Files in the protocol reference); the board stores only which stored file each picture uses (`files`), so boards stay small. A new picture stays free while it is selected, so it can be dragged into place, and is locked once it is let go of, so drawing on top does not move it. A lock on each picture's corner locks or unlocks just that one (a locked picture cannot be clicked in Excalidraw). Copy as image (header button or Shift+Alt+C) puts the selection, or the whole board, on the clipboard as a PNG with `clipboard.writeImage`; Save as image saves the same PNG in `Pictures\Tavora` with `pictures.save`, named after the board and the time. Clear board takes everything off the board, with Undo. The toolbar can sit at the top or the bottom (main menu; one choice for every game, in `storage.app`), the palette is compact with ten quick colours (a pnpm patch of Excalidraw's colour picks, `patches/`) and shows only its main options (the rest under More options, the Layers row hidden). Stored files no board uses and older than an hour are removed when a panel opens. Excalidraw's style palette gets a handle to drag it around the board or fold it away. Each panel remembers the board it shows, the view (scroll and zoom) of each board, and where its palette is. |
| `discord` | `tavora.discord` | No documents. The channel to rejoin in its settings shared by every game (`storage.app`, key `last`), and the server a game remembers in that game's settings (`server`). Everything else comes live from the Discord app through Tavora's `discord` connector, which keeps the sign-in; the module asks for nothing but that connector. |
| `playground` | `tavora.playground` | Nothing. It shows every shared control (colours, type, buttons, fields, choices, tabs, badges, menus, dialogs, rows, notices) on its own, to try out the look and feel. Each panel remembers its filter and the Disabled switch. |
| `shared` | `@tavora/official-ui` | Not a module. Theme CSS, shadcn-vue components and the save helpers, bundled into the modules. |

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
with `start`, rebuild a module after changing it. A new shared control goes in
`shared/src/components` and gets a specimen in the playground.

## Standalone game modules

`enshrouded` is a separate installable GPL-3.0-or-later Enshrouded 1.0 planner. It is excluded from the bundled official modules. See its README and upstream notices before distribution.
