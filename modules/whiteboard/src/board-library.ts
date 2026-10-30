// The Whiteboard's boards: which ones exist, which one this panel has open, and making, renaming and deleting them.
// Each board is one document, shared by every Whiteboard panel of the workspace, and the open one is the item session's
// (`openItems`), so a restart, `panels.open` and another panel's changes are handled there. The board is whole-document
// edited by Excalidraw, so its handle merges as `"mine"`: this panel's drawing wins over a save made in between.
// No framework in here; the page mirrors what it reads.

import { TavoraError, type JsonValue, type TavoraSDK } from "@tavora/sdk";
import { openItems, type DocumentHandle, type ItemSession, type ItemSessionEvent } from "@tavora/sdk/store";
import { boardTitle, cleanName, emptyBoard, newBoardId, parseBoard, sortBoards, uniqueName, type BoardData, type BoardSummary } from "./boards";

/** Every board's document id starts with this. The starter board's id is `STARTER_ID`. */
export const BOARD_PREFIX = "board-";

export type BoardKind = "blank" | "idea" | "screenshot";

/** The words boards are named with; read when a board is made, as the language can change. */
export interface BoardWords {
  board: string;
  idea: string;
  screenshot: string;
}

export interface BoardLibraryOptions {
  words(): BoardWords;
  debounceMs?: number;
}

/** What the open board's view lets the library do around a switch. */
export interface OpenBoardView {
  /** Stores what was drawn but not handed to the board's document yet. */
  flush(): Promise<void>;
  /** Lets go without storing what is left (the board is being deleted). */
  discard(): void;
}

const isConflict = (error: unknown): boolean => error instanceof TavoraError && error.code === "CONFLICT";

export type BoardLibrary = Awaited<ReturnType<typeof openBoardLibrary>>;

export async function openBoardLibrary(sdk: TavoraSDK, options: BoardLibraryOptions) {
  let view: OpenBoardView | null = null;

  const session: ItemSession<BoardData> = await openItems<BoardData>(sdk, {
    prefix: BOARD_PREFIX,
    parse: (raw) => parseBoard(raw),
    title: boardTitle,
    rename: (draft, title) => void (draft.name = title),
    merge: "mine",
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    // The board is open in a panel until the user switches: another panel deleting it must not switch this one.
    onDeleted: "keep",
    // A switch asked for by `panels.open` first stores what the board in the panel has not handed over yet.
    followNavigate: false,
    restore: (launch, state) => {
      const saved = launch.reason !== "add" && launch.content?.id ? launch.content.id : (state as { selected?: unknown } | null)?.selected;
      return typeof saved === "string" ? saved : null;
    },
    whenEmpty: () => ({ data: emptyBoard(), title: `${options.words().board} 1` }),
  });

  /** Boards made before they carried their name keep it in the document's title only: bring it into the data once. */
  function nameFromTitle() {
    const open = session.current;
    if (!open || session.deleted || open.data.name) return;
    const title = session.items.find((item) => item.id === session.currentId)?.title;
    if (title) open.update((draft) => void (draft.name ||= title));
  }
  nameFromTitle();
  session.onChange((event) => {
    if (event.type === "current" && event.source === "pick") nameFromTitle();
  });

  const stopNavigating = sdk.panel.onNavigate(async (content) => {
    await view?.flush();
    if (!(await session.job(() => session.pick(content.id)))) throw new Error("another board was picked first");
  });

  async function create(kind: BoardKind, data: BoardData = emptyBoard(), id: string = newBoardId()): Promise<string> {
    const words = options.words();
    const names = session.items.map((item) => item.title);
    const name = kind === "blank" ? uniqueName(names, words.board, names.length + 1) : uniqueName(names, kind === "idea" ? words.idea : words.screenshot);
    await view?.flush();
    await sdk.documents.put({ id, title: name, data: { ...data, name } as unknown as JsonValue, ifRevision: 0 });
    await session.refresh();
    await session.pick(id);
    return id;
  }

  return {
    /** The boards in the order they were made. Replaced, never changed. */
    get boards(): BoardSummary[] {
      return sortBoards(session.items.map((item) => ({ id: item.id, name: item.title, revision: item.revision })));
    },
    get currentId() {
      return session.currentId;
    },
    /** The open board's document; its `data` and `update` are the document store's. */
    get current(): DocumentHandle<BoardData> | null {
      return session.current;
    },
    /** Another panel deleted the open board; it stays open until the user leaves it or brings it back. */
    get deleted() {
      return session.deleted;
    },
    onChange: (fn: (event: ItemSessionEvent) => void) => session.onChange(fn),
    onError: (fn: (error: unknown) => void) => session.onError(fn),

    /** The view of the open board, so a switch can store what it holds first. Pass null when it goes away. */
    attach(next: OpenBoardView | null) {
      view = next;
    },
    detach(old: OpenBoardView) {
      if (view === old) view = null;
    },

    /** Opens a board. Rejects when it does not exist any more or the open one could not be stored (it then stays open). */
    async open(id: string): Promise<boolean> {
      await view?.flush();
      return session.pick(id);
    },

    /**
     * Makes a board (named after `kind`), stores it and opens it. `data` is what it starts with, `id` is only given when
     * the caller needs it before the board is open. Resolves with its id.
     */
    create,

    async rename(id: string, value: string): Promise<void> {
      const name = cleanName(value);
      if (!name || name === session.items.find((item) => item.id === id)?.title) return;
      await session.rename(id, name);
    },

    /**
     * Deletes a board; there is always one left, so a blank one is made when it was the last. Resolves with a way to put
     * it back as it was (Undo).
     */
    async remove(id: string): Promise<() => Promise<void>> {
      if (id === session.currentId) view?.discard();
      let undo: () => Promise<void>;
      try {
        undo = await session.remove(id);
      } catch (error) {
        if (!isConflict(error)) throw error;
        // Another panel saved the board since the list was read: delete the copy it has now.
        await session.refresh();
        undo = await session.remove(id);
      }
      if (session.items.length === 0 && !session.currentId) await create("blank");
      return undo;
    },

    /** After another panel deleted the open board: puts it back as this panel last saw it, and opens it. */
    restoreDeleted: () => session.restoreDeleted(),

    /** The ids of every stored file that a board uses, to find the ones nobody uses any more. */
    async usedFiles(): Promise<Set<string>> {
      const used = new Set<string>();
      for (const document of await sdk.documents.list()) {
        if (!document.id.startsWith(BOARD_PREFIX)) continue;
        const board = await sdk.documents.get(document.id);
        if (board) for (const file of Object.values(parseBoard(board.data).files)) used.add(file.blobId);
      }
      return used;
    },

    async dispose() {
      stopNavigating();
      await session.dispose();
    },
  };
}
