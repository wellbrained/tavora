# Game → Workspace rename (done)

Decided with the owner on 2026-10-27. An item on the rail is a **workspace**: a game workspace (linked to a game) or a personal workspace. "Game" stays only where a real game is meant. Before 1.0 no code, data or docs may use the old meaning. Shipped in Tavora 0.21.43, before the [overlay setups](overlay-setups.md).

Status: done. The scope below is what was changed.

## Scope

- **User text**, English and German: rail, menus, onboarding, settings, dialogs.
- **Code**: `GameEntry`, `GameWorkspace`, `lastGameId`, `gameEndWorkspace`, and every `gameId` that means the rail item (`workspaceId`). Roughly 800 hits in 60 files; each needs a call, because `gameId` also means real games (game watcher, Steam ids, a module's `games`).
- **Saved data**: a one-time move on start renames the keys in `library.json` (`games`, `lastGameId`, `gameEndWorkspace`) and every rail-item `gameId` in the workspace, overlay and other data files. The old files are copied to a backup first. Older Tavora versions can't read the moved data; the patch note says so. Data folder paths don't change.
- **SDK**: `tavora.workspace.getCurrent()` and the type `TavoraWorkspace`. `game.getCurrent` and the old manifest field `workspaces` were removed for 1.0 (SDK 0.4.0, module-schema 0.2.0): the manifest has `personalWorkspaces` only, and a manifest with `workspaces` is refused. Modules in `modules/` and `wellbrained/tavora-modules` move to the new name in the same step.
- **Docs**: `apps/docs`, the glossary, `docs/features`.

## Stays

- The manifest's `games` field and `create-module --game`: they mean real games.
