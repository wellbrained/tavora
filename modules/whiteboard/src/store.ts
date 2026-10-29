// Reads and writes boards through the SDK. Each board is one document, shared by every Whiteboard panel of
// the workspace; its title is the board's name, so the list needs no board to be opened.

import { TavoraError, type TavoraSDK } from "@tavora/sdk";
import { emptyBoard, isBoardId, newBoardId, parseBoard, sortBoards, type BoardData, type BoardSummary } from "./boards";

export type Boards = ReturnType<typeof createBoards>;

export interface OpenBoard {
  data: BoardData;
  revision: number;
}

export function createBoards(sdk: TavoraSDK) {
  return {
    async list(): Promise<BoardSummary[]> {
      const documents = await sdk.documents.list();
      return sortBoards(documents.filter((document) => isBoardId(document.id)).map((document) => ({ id: document.id, name: document.title, revision: document.revision })));
    },

    async open(id: string): Promise<OpenBoard | null> {
      const document = await sdk.documents.get(id);
      return document ? { data: parseBoard(document.data), revision: document.revision } : null;
    },

    async create(name: string, data: BoardData = emptyBoard()): Promise<BoardSummary> {
      const id = newBoardId();
      const saved = await sdk.documents.put({ id, title: name, data, ifRevision: 0 });
      return { id, name, revision: saved.revision };
    },

    /**
     * Saves what this panel shows. If another panel saved in between, this panel's drawing still wins, as it is
     * the one being drawn in; the newest revision is taken and the save repeated.
     */
    async save(id: string, name: string, data: BoardData, revision: number): Promise<number> {
      let known = revision;
      for (let attempt = 1; ; attempt++) {
        try {
          return (await sdk.documents.put({ id, title: name, data, ifRevision: known })).revision;
        } catch (error) {
          if (!(error instanceof TavoraError) || error.code !== "CONFLICT" || attempt >= 4) throw error;
          known = (await sdk.documents.get(id))?.revision ?? 0;
        }
      }
    },

    /** The ids of every stored file that a board uses, to find the ones nobody uses any more. */
    async usedFiles(): Promise<Set<string>> {
      const used = new Set<string>();
      for (const document of await sdk.documents.list()) {
        if (!isBoardId(document.id)) continue;
        const board = await sdk.documents.get(document.id);
        if (board) for (const file of Object.values(parseBoard(board.data).files)) used.add(file.blobId);
      }
      return used;
    },

    async rename(id: string, name: string): Promise<void> {
      const document = await sdk.documents.get(id);
      if (document) await sdk.documents.put({ id, title: name, data: document.data, ifRevision: document.revision });
    },

    async remove(id: string): Promise<void> {
      await sdk.documents.delete(id);
    },

    /** Puts a deleted board back as it was (Undo). */
    async restore(id: string, name: string, data: BoardData): Promise<void> {
      await sdk.documents.put({ id, title: name, data, ifRevision: 0 });
    },
  };
}
