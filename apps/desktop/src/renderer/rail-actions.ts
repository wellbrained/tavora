// Menus for games and folders on the rail. Every drag-and-drop move has a
// menu equivalent here, so the rail works from the keyboard too.
import type { FolderView, GameView } from "../shared/host-api";
import { act, confirmAction, dialog, prompt, state, submitAction, type MenuItem } from "./host";

function lib() {
  return state.value!.library;
}

/** Where a game sits: the top level (folderId null) or a folder, and its index there. */
export function placement(gameId: string): { folderId: string | null; index: number; size: number } {
  const library = lib();
  for (const folder of Object.values(library.folders)) {
    const index = folder.games.indexOf(gameId);
    if (index >= 0) return { folderId: folder.id, index, size: folder.games.length };
  }
  const index = library.root.findIndex((item) => item.kind === "game" && item.id === gameId);
  return { folderId: null, index, size: library.root.length };
}

export function newFolderWith(gameId: string): void {
  prompt({
    title: "New folder",
    label: "Folder name",
    confirm: "Create",
    submit: (name) => submitAction({ type: "create-folder", name, gameIds: [gameId] }),
  });
}

export function gameMenu(game: GameView, options: { inFavorites?: boolean } = {}): MenuItem[] {
  const library = lib();
  const favoriteIndex = library.favorites.indexOf(game.id);
  const isFavorite = favoriteIndex >= 0;
  const where = placement(game.id);
  const manual = library.sort === "manual" || where.folderId !== null;

  const items: MenuItem[] = [
    { label: "Open", testid: "menu-open", run: () => act({ type: "open-game", gameId: game.id }) },
    isFavorite
      ? { label: "Remove from Favorites", testid: "menu-unfavorite", run: () => act({ type: "unfavorite", gameId: game.id }) }
      : { label: "Add to Favorites", testid: "menu-favorite", run: () => act({ type: "favorite", gameId: game.id }) },
  ];

  if (options.inFavorites) {
    items.push(
      {
        label: "Move up in Favorites",
        testid: "menu-favorite-up",
        disabled: favoriteIndex <= 0,
        run: () => act({ type: "favorite", gameId: game.id, index: favoriteIndex - 1 }),
      },
      {
        label: "Move down in Favorites",
        testid: "menu-favorite-down",
        disabled: favoriteIndex >= library.favorites.length - 1,
        run: () => act({ type: "favorite", gameId: game.id, index: favoriteIndex + 1 }),
      },
    );
    return items;
  }

  items.push({
    label: "Move to folder",
    testid: "menu-move-to-folder",
    submenu: () => [
      ...Object.values(library.folders)
        .filter((folder) => folder.id !== where.folderId)
        .map(
          (folder): MenuItem => ({
            label: folder.name,
            testid: `menu-folder-${folder.id}`,
            run: () => act({ type: "move-game", gameId: game.id, folderId: folder.id }),
          }),
        ),
      { label: "New folder…", testid: "menu-new-folder", run: () => newFolderWith(game.id) },
    ],
  });
  if (where.folderId) {
    items.push({
      label: "Take out of folder",
      testid: "menu-unfolder",
      run: () => act({ type: "move-game", gameId: game.id, folderId: null }),
    });
  }
  if (manual) {
    items.push(
      {
        label: "Move up",
        testid: "menu-up",
        disabled: where.index <= 0,
        run: () => act({ type: "move-game", gameId: game.id, folderId: where.folderId, index: where.index - 1 }),
      },
      {
        label: "Move down",
        testid: "menu-down",
        disabled: where.index >= where.size - 1,
        run: () => act({ type: "move-game", gameId: game.id, folderId: where.folderId, index: where.index + 1 }),
      },
    );
  }
  items.push(
    {
      label: "Rename…",
      testid: "menu-rename",
      run: () =>
        prompt({
          title: `Rename ${game.name}`,
          label: "Name",
          value: game.name,
          confirm: "Rename",
          submit: (name) => submitAction({ type: "rename-game", gameId: game.id, name }),
        }),
    },
    {
      label: "Change icon",
      testid: "menu-icon",
      // Three choices, one current: choosing any replaces the others, so there is nothing to "remove".
      submenu: () => [
        {
          label: "Original icon",
          testid: "menu-icon-original",
          checked: game.iconChoice === "original",
          run: () => act({ type: "use-original-icon", gameId: game.id }),
        },
        {
          label: "Set letters…",
          testid: "menu-icon-label",
          checked: game.iconChoice === "letters",
          run: () =>
            prompt({
              title: "Icon letters",
              label: "Up to 3 letters or digits",
              value: game.icon.kind === "monogram" ? game.icon.text : "",
              maxLength: 3,
              confirm: "Save",
              submit: (label) => submitAction({ type: "set-game-label", gameId: game.id, label }),
            }),
        },
        {
          label: "Select own icon…",
          testid: "menu-icon-image",
          checked: game.iconChoice === "image",
          run: () => act({ type: "choose-game-image", gameId: game.id }),
        },
      ],
    },
    // Only for a game whose own icon Tavora does not have yet: the whole item is the offer.
    ...(game.shareIcon
      ? [{ label: "Share icon", testid: "menu-share-icon", run: () => (dialog.value = { kind: "share-icons", gameIds: [game.id] }) } satisfies MenuItem]
      : []),
    {
      label: "Remove game…",
      testid: "menu-remove",
      danger: true,
      run: () =>
        confirmAction({
          title: `Remove ${game.name}?`,
          message:
            "The game, its workspace and all module data move to Trash. You can restore them from Settings for 30 days; after that they are deleted for good.",
          confirm: "Move to Trash",
          danger: true,
          run: () => submitAction({ type: "trash-game", gameId: game.id }),
        }),
    },
  );
  return items;
}

export function folderMenu(folder: FolderView): MenuItem[] {
  const library = lib();
  const index = library.root.findIndex((item) => item.kind === "folder" && item.id === folder.id);
  const items: MenuItem[] = [
    {
      label: "Rename…",
      testid: "menu-rename",
      run: () =>
        prompt({
          title: `Rename ${folder.name}`,
          label: "Folder name",
          value: folder.name,
          confirm: "Rename",
          submit: (name) => submitAction({ type: "rename-folder", folderId: folder.id, name }),
        }),
    },
    {
      label: "Set letters…",
      testid: "menu-folder-label",
      run: () =>
        prompt({
          title: "Folder letters",
          label: "Shown instead of the game icons, up to 3 characters",
          value: folder.label ?? "",
          maxLength: 3,
          confirm: "Save",
          submit: (label) => submitAction({ type: "set-folder-label", folderId: folder.id, label }),
        }),
    },
  ];
  if (folder.label) {
    items.push({
      label: "Show game icons",
      testid: "menu-folder-collage",
      run: () => act({ type: "set-folder-label", folderId: folder.id, label: null }),
    });
  }
  if (library.sort === "manual") {
    items.push(
      {
        label: "Move up",
        testid: "menu-up",
        disabled: index <= 0,
        run: () => act({ type: "move-folder", folderId: folder.id, index: index - 1 }),
      },
      {
        label: "Move down",
        testid: "menu-down",
        disabled: index >= library.root.length - 1,
        run: () => act({ type: "move-folder", folderId: folder.id, index: index + 1 }),
      },
    );
  }
  items.push({
    label: "Delete folder",
    testid: "menu-delete-folder",
    danger: true,
    run: () =>
      confirmAction({
        title: `Delete ${folder.name}?`,
        message: "Its games move back to the game list. No game or data is removed.",
        confirm: "Delete folder",
        danger: true,
        run: () => submitAction({ type: "delete-folder", folderId: folder.id }),
      }),
  });
  return items;
}
