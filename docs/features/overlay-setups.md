# Overlay setups (planned)

Decided with the owner on 2026-10-27. Replaces the Overlay layout window and the per-game overrides described in [overlay-layout.md](overlay-layout.md) once built. The [Game → Workspace rename](workspace-rename.md) comes first, so this work uses the new names.

## Setups

An overlay setup is a saved overlay layout: which items show, where, and how each one is set (mode, opacity, hotkey, Hide from capture).

| Setup | Exists | Shows when |
|---|---|---|
| Everywhere | always | always, over any app, except while Tavora's own window is in front |
| All games | always | a game is in front that has no setup of its own |
| One per game workspace | added by the player | that game is in front |

- On screen: Everywhere, plus either the game's own setup or All games. Game setups stand alone; they never stack with All games.
- A game setup is added by right-clicking the workspace on the rail ("Add overlay" / "Overlay hinzufügen") or with "Add overlay for…" in the Overlay page's dropdown; removed with "Remove overlay" / "Overlay entfernen". Removing a workspace removes its setup.
- Up to 8 items per setup.
- Per-game overrides of general positions ("Customize for this game", "Follow All games") go away.
- Nested setups (a "Basic" setup inside a game setup) are dropped for now and kept only as a loose idea.

## Items and sources

An item is an existing panel from some workspace, or a module overlay (`overlay.showOverGame`). It is the same panel as in its workspace, never a copy; closing the panel in its workspace removes it from every setup. One panel can be in several setups, with its own position and settings in each.

- Panels from a personal workspace can go into any setup.
- Panels from a game workspace (game modules and general modules such as Notes alike) can only go into that game's setup.
- Module overlays land in their game's setup (created if missing), or in All games when they come from a personal workspace. Personal items can move between Everywhere and All games.

## Overlay page

A page in the main window; the separate Overlay layout window goes away.

- Above the canvas: the setup dropdown. It opens on the running game's setup, else All games while a game runs, else Everywhere.
- Canvas: game setups keep Take picture from the running game; Everywhere and All games use a plain screen-sized area.
- Sidebar, two stacked panels:
  - Sources, with search: every panel from every workspace, its source named ("Notes · Satisfactory"). Ones that can't go into the chosen setup are greyed out with the reason.
  - Settings of the selected item (picked in the list or on the canvas), sized to its content; a short hint when nothing is selected.

## Header

A two-part button in the workspace header, next to Layouts:

- **Overlay** opens the Overlay page.
- **Live** icon pauses and resumes overlays (today's "Hide all for now"), with three looks: Live (something shows now), Ready (on, nothing shows), Paused.

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

## Steps

0. [Game → Workspace rename](workspace-rename.md).
1. Setups in the data, the which-setup-shows rule, the source rules, the limit, showing outside games, the data move, the security page.
2. The Overlay page; Add overlay / Remove overlay on the workspace.
3. The header button and the live state; Settings trimmed.

Each step adds a patch note; the last one raises the minor version once the owner calls the feature complete.
