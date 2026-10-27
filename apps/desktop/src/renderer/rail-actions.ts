// Menus for workspaces and folders on the rail. Every drag-and-drop move has a
// menu equivalent here, so the rail works from the keyboard too.
import type { FolderView, WorkspaceView } from "../shared/host-api";
import { act, confirmAction, dialog, openSettings, prompt, state, submitAction, type MenuItem } from "./host";
import { t } from "./i18n";

function lib() {
  return state.value!.library;
}

/** Where a workspace sits: the top level (folderId null) or a folder, and its index there. */
export function placement(workspaceId: string): { folderId: string | null; index: number; size: number } {
  const library = lib();
  for (const folder of Object.values(library.folders)) {
    const index = folder.workspaces.indexOf(workspaceId);
    if (index >= 0) return { folderId: folder.id, index, size: folder.workspaces.length };
  }
  const index = library.root.findIndex((item) => item.kind === "workspace" && item.id === workspaceId);
  return { folderId: null, index, size: library.root.length };
}

export function newFolderWith(workspaceId: string): void {
  prompt({
    title: t("rail.newFolder.title"),
    label: t("rail.folderName"),
    confirm: t("rail.newFolder.confirm"),
    submit: (name) => submitAction({ type: "create-folder", name, workspaceIds: [workspaceId] }),
  });
}

export function workspaceMenu(workspace: WorkspaceView, options: { inFavorites?: boolean } = {}): MenuItem[] {
  const library = lib();
  const favoriteIndex = library.favorites.indexOf(workspace.id);
  const isFavorite = favoriteIndex >= 0;

  const items: MenuItem[] = [
    { label: t("menu.open"), testid: "menu-open", run: () => act({ type: "open-workspace", workspaceId: workspace.id }) },
    isFavorite
      ? { label: t("menu.favorite.remove"), testid: "menu-unfavorite", run: () => act({ type: "unfavorite", workspaceId: workspace.id }) }
      : { label: t("menu.favorite.add"), testid: "menu-favorite", run: () => act({ type: "favorite", workspaceId: workspace.id }) },
  ];

  if (options.inFavorites) {
    items.push(
      {
        label: t("menu.favorite.up"),
        testid: "menu-favorite-up",
        disabled: favoriteIndex <= 0,
        run: () => act({ type: "favorite", workspaceId: workspace.id, index: favoriteIndex - 1 }),
      },
      {
        label: t("menu.favorite.down"),
        testid: "menu-favorite-down",
        disabled: favoriteIndex >= library.favorites.length - 1,
        run: () => act({ type: "favorite", workspaceId: workspace.id, index: favoriteIndex + 1 }),
      },
    );
  } else {
    placeItems(items, workspace);
  }
  items.push(...ownItems(workspace));
  return items;
}

/** Where on the main list a workspace goes: into or out of a folder, up or down. */
function placeItems(items: MenuItem[], workspace: WorkspaceView): void {
  const library = lib();
  const where = placement(workspace.id);
  const manual = library.sort === "manual" || where.folderId !== null;
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
            run: () => act({ type: "move-workspace", workspaceId: workspace.id, folderId: folder.id }),
          }),
        ),
      { label: t("menu.newFolder"), testid: "menu-new-folder", run: () => newFolderWith(workspace.id) },
    ],
  });
  if (where.folderId) {
    items.push({
      label: t("menu.takeOut"),
      testid: "menu-unfolder",
      run: () => act({ type: "move-workspace", workspaceId: workspace.id, folderId: null }),
    });
  }
  if (manual) {
    items.push(
      {
        label: t("menu.moveUp"),
        testid: "menu-up",
        disabled: where.index <= 0,
        run: () => act({ type: "move-workspace", workspaceId: workspace.id, folderId: where.folderId, index: where.index - 1 }),
      },
      {
        label: t("menu.moveDown"),
        testid: "menu-down",
        disabled: where.index >= where.size - 1,
        run: () => act({ type: "move-workspace", workspaceId: workspace.id, folderId: where.folderId, index: where.index + 1 }),
      },
    );
  }
}

/** What belongs to the workspace itself, wherever it sits on the rail (favorites included). */
function ownItems(workspace: WorkspaceView): MenuItem[] {
  return [
    {
      label: t("menu.rename"),
      testid: "menu-rename",
      run: () =>
        prompt({
          title: t("menu.rename.title", { name: workspace.name }),
          label: t("menu.rename.label"),
          value: workspace.name,
          confirm: t("menu.rename.confirm"),
          submit: (name) => submitAction({ type: "rename-workspace", workspaceId: workspace.id, name }),
        }),
    },
    {
      label: t("menu.changeIcon"),
      testid: "menu-icon",
      // Three choices, one current: choosing any replaces the others, so there is nothing to "remove".
      submenu: () => [
        // A workspace has no icon of its own; its letters are where it starts.
        ...(workspace.kind === "game"
          ? [
              {
                label: t("menu.icon.original"),
                testid: "menu-icon-original",
                checked: workspace.iconChoice === "original",
                run: () => act({ type: "use-original-icon", workspaceId: workspace.id }),
              } satisfies MenuItem,
            ]
          : []),
        {
          label: t("menu.icon.letters"),
          testid: "menu-icon-label",
          checked: workspace.iconChoice === "letters",
          run: () =>
            prompt({
              title: t("menu.icon.letters.title"),
              label: t("menu.icon.letters.label"),
              value: workspace.icon.kind === "monogram" ? workspace.icon.text : "",
              maxLength: 3,
              confirm: t("common.save"),
              submit: (label) => submitAction({ type: "set-workspace-label", workspaceId: workspace.id, label }),
            }),
        },
        {
          label: t("menu.icon.own"),
          testid: "menu-icon-image",
          checked: workspace.iconChoice === "image",
          run: () => act({ type: "choose-workspace-image", workspaceId: workspace.id }),
        },
      ],
    },
    // Only for a game workspace whose game's icon Tavora does not have yet: the whole item is the offer.
    ...(workspace.shareIcon
      ? [{ label: t("menu.shareIcon"), testid: "menu-share-icon", run: () => (dialog.value = { kind: "share-icons", workspaceIds: [workspace.id] }) } satisfies MenuItem]
      : []),
    // Removing many workspaces at once happens in Settings > Workspaces.
    { label: t("menu.manageWorkspaces"), testid: "menu-manage-workspaces", separator: true, run: () => openSettings({ section: "workspaces" }) },
    {
      label: t("menu.removeWorkspace"),
      testid: "menu-remove",
      danger: true,
      run: () =>
        confirmAction({
          title: t("menu.remove.title", { name: workspace.name }),
          message: t("menu.remove.message"),
          confirm: t("menu.remove.confirm"),
          danger: true,
          run: () => submitAction({ type: "trash-workspace", workspaceId: workspace.id }),
        }),
    },
  ];
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
