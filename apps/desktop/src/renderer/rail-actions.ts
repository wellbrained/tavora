// Menus for games and folders on the rail. Every drag-and-drop move has a
// menu equivalent here, so the rail works from the keyboard too.
import type { FolderView, GameView } from "../shared/host-api";
import { act, confirmAction, dialog, openSettings, prompt, state, submitAction, type MenuItem } from "./host";
import { t } from "./i18n";

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
    title: t("rail.newFolder.title"),
    label: t("rail.folderName"),
    confirm: t("rail.newFolder.confirm"),
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
    { label: t("menu.open"), testid: "menu-open", run: () => act({ type: "open-game", gameId: game.id }) },
    isFavorite
      ? { label: t("menu.favorite.remove"), testid: "menu-unfavorite", run: () => act({ type: "unfavorite", gameId: game.id }) }
      : { label: t("menu.favorite.add"), testid: "menu-favorite", run: () => act({ type: "favorite", gameId: game.id }) },
  ];

  if (options.inFavorites) {
    items.push(
      {
        label: t("menu.favorite.up"),
        testid: "menu-favorite-up",
        disabled: favoriteIndex <= 0,
        run: () => act({ type: "favorite", gameId: game.id, index: favoriteIndex - 1 }),
      },
      {
        label: t("menu.favorite.down"),
        testid: "menu-favorite-down",
        disabled: favoriteIndex >= library.favorites.length - 1,
        run: () => act({ type: "favorite", gameId: game.id, index: favoriteIndex + 1 }),
      },
    );
    return items;
  }

  items.push({
    label: t("menu.moveToFolder"),
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
      { label: t("menu.newFolder"), testid: "menu-new-folder", run: () => newFolderWith(game.id) },
    ],
  });
  if (where.folderId) {
    items.push({
      label: t("menu.takeOut"),
      testid: "menu-unfolder",
      run: () => act({ type: "move-game", gameId: game.id, folderId: null }),
    });
  }
  if (manual) {
    items.push(
      {
        label: t("menu.moveUp"),
        testid: "menu-up",
        disabled: where.index <= 0,
        run: () => act({ type: "move-game", gameId: game.id, folderId: where.folderId, index: where.index - 1 }),
      },
      {
        label: t("menu.moveDown"),
        testid: "menu-down",
        disabled: where.index >= where.size - 1,
        run: () => act({ type: "move-game", gameId: game.id, folderId: where.folderId, index: where.index + 1 }),
      },
    );
  }
  items.push(
    {
      label: t("menu.rename"),
      testid: "menu-rename",
      run: () =>
        prompt({
          title: t("menu.rename.title", { name: game.name }),
          label: t("menu.rename.label"),
          value: game.name,
          confirm: t("menu.rename.confirm"),
          submit: (name) => submitAction({ type: "rename-game", gameId: game.id, name }),
        }),
    },
    {
      label: t("menu.changeIcon"),
      testid: "menu-icon",
      // Three choices, one current: choosing any replaces the others, so there is nothing to "remove".
      submenu: () => [
        // A workspace has no icon of its own; its letters are where it starts.
        ...(game.kind === "game"
          ? [
              {
                label: t("menu.icon.original"),
                testid: "menu-icon-original",
                checked: game.iconChoice === "original",
                run: () => act({ type: "use-original-icon", gameId: game.id }),
              } satisfies MenuItem,
            ]
          : []),
        {
          label: t("menu.icon.letters"),
          testid: "menu-icon-label",
          checked: game.iconChoice === "letters",
          run: () =>
            prompt({
              title: t("menu.icon.letters.title"),
              label: t("menu.icon.letters.label"),
              value: game.icon.kind === "monogram" ? game.icon.text : "",
              maxLength: 3,
              confirm: t("common.save"),
              submit: (label) => submitAction({ type: "set-game-label", gameId: game.id, label }),
            }),
        },
        {
          label: t("menu.icon.own"),
          testid: "menu-icon-image",
          checked: game.iconChoice === "image",
          run: () => act({ type: "choose-game-image", gameId: game.id }),
        },
      ],
    },
    // Only for a game whose own icon Tavora does not have yet: the whole item is the offer.
    ...(game.shareIcon
      ? [{ label: t("menu.shareIcon"), testid: "menu-share-icon", run: () => (dialog.value = { kind: "share-icons", gameIds: [game.id] }) } satisfies MenuItem]
      : []),
    // Removing many games at once happens in Settings > Games.
    ...(game.kind === "game"
      ? [{ label: t("menu.manageGames"), testid: "menu-manage-games", separator: true, run: () => openSettings({ section: "games" }) } satisfies MenuItem]
      : []),
    {
      label: t(game.kind === "workspace" ? "menu.removeWorkspace" : "menu.removeGame"),
      testid: "menu-remove",
      danger: true,
      run: () =>
        confirmAction({
          title: t("menu.remove.title", { name: game.name }),
          message: t(game.kind === "workspace" ? "menu.remove.workspaceMessage" : "menu.remove.message"),
          confirm: t("menu.remove.confirm"),
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
      label: t("menu.rename"),
      testid: "menu-rename",
      run: () =>
        prompt({
          title: t("menu.rename.title", { name: folder.name }),
          label: t("rail.folderName"),
          value: folder.name,
          confirm: t("menu.rename.confirm"),
          submit: (name) => submitAction({ type: "rename-folder", folderId: folder.id, name }),
        }),
    },
    {
      label: t("menu.icon.letters"),
      testid: "menu-folder-label",
      run: () =>
        prompt({
          title: t("menu.folder.letters.title"),
          label: t("menu.folder.letters.label"),
          value: folder.label ?? "",
          maxLength: 3,
          confirm: t("common.save"),
          submit: (label) => submitAction({ type: "set-folder-label", folderId: folder.id, label }),
        }),
    },
  ];
  if (folder.label) {
    items.push({
      label: t("menu.folder.showIcons"),
      testid: "menu-folder-collage",
      run: () => act({ type: "set-folder-label", folderId: folder.id, label: null }),
    });
  }
  if (library.sort === "manual") {
    items.push(
      {
        label: t("menu.moveUp"),
        testid: "menu-up",
        disabled: index <= 0,
        run: () => act({ type: "move-folder", folderId: folder.id, index: index - 1 }),
      },
      {
        label: t("menu.moveDown"),
        testid: "menu-down",
        disabled: index >= library.root.length - 1,
        run: () => act({ type: "move-folder", folderId: folder.id, index: index + 1 }),
      },
    );
  }
  items.push({
    label: t("menu.folder.delete"),
    testid: "menu-delete-folder",
    danger: true,
    run: () =>
      confirmAction({
        title: t("menu.folder.delete.title", { name: folder.name }),
        message: t("menu.folder.delete.message"),
        confirm: t("menu.folder.delete"),
        danger: true,
        run: () => submitAction({ type: "delete-folder", folderId: folder.id }),
      }),
  });
  return items;
}
