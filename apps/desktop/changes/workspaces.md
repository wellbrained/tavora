tags: library, workspaces, sdk

# Everything on the rail is a workspace

- Each item on the rail is now a workspace: a game workspace for a game, or a personal workspace.
- Settings > Workspaces lists all of them, personal ones too.
- Your saved data moves to the new names once, on the first start. A copy of the old files stays in the `backups/before-workspaces` folder.
- Older Tavora versions can't read the moved data. If you use cloud copy, update Tavora on every PC.
- Modules can ask which workspace they're in with `workspace.getCurrent()`.
