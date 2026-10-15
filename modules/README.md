# Official modules

Notes, To-Dos and the UI Playground ship with Tavora and are shown as
**Official**. They are ordinary modules: a `tavora.module.json`, a Vite build
in `dist/`, and only the public [`@tavora/sdk`](../packages/sdk/README.md) to talk to the host. A
community module could do everything they do.

| Folder | Module | What it stores |
| --- | --- | --- |
| `notes` | `tavora.notes` | One document per note, plus the `scratchpad` document every game has. Each holds the Tiptap JSON, its plain text (for search and the list), `pinned` and `createdAt`. The panel remembers which note it shows. |
| `todos` | `tavora.todos` | One `todos` document per game with groups, tasks (title, details, source link, pinned, steps) and their order. Each panel remembers what is open, folded or hidden. |
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
