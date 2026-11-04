// The spreadsheets of this workspace in the SDK's document store, one document each ("sheet-…"). The list comes from
// the store's summaries (the title is the name) and follows other panels; the open one is a document handle with the
// default conflict policy: an edit is a change applied again on the newest copy, so two panels editing different
// cells both keep theirs.
import { errorMessage } from "@tavora/official-ui";
import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { openDocument, type DocumentChangeEvent, type DocumentHandle } from "@tavora/sdk/store";
import { shallowRef } from "vue";
import { DOC_PREFIX, LIMITS, documentBytes, parseSpreadsheet, type SpreadsheetData } from "./model";

export interface SpreadsheetEntry {
  id: string;
  name: string;
}

/** A document too big for the store, refused before saving. */
export class TooLarge extends Error {}

export const newId = (): string => `${DOC_PREFIX}${crypto.randomUUID()}`;

const titleOf = (data: SpreadsheetData) => data.name.trim() || "Spreadsheet";

export async function createSpreadsheets(sdk: TavoraSDK) {
  const list = shallowRef<SpreadsheetEntry[]>([]);

  const byName = (a: SpreadsheetEntry, b: SpreadsheetEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);

  async function refresh(): Promise<void> {
    const summaries = await sdk.documents.list();
    list.value = summaries.filter((summary) => summary.id.startsWith(DOC_PREFIX)).map((summary) => ({ id: summary.id, name: summary.title })).sort(byName);
  }

  let refreshing: Promise<void> | null = null;
  const stopWatching = sdk.documents.onChange((change) => {
    if (!change.id.startsWith(DOC_PREFIX)) return;
    // Several changes in a row read the list once.
    refreshing ??= refresh()
      .catch(() => undefined)
      .finally(() => (refreshing = null));
  });

  await refresh();

  /** Saves a new spreadsheet (or one put back after a delete) under its id. */
  async function put(id: string, data: SpreadsheetData): Promise<void> {
    if (documentBytes(data) > LIMITS.bytes) throw new TooLarge();
    await sdk.documents.put({ id, title: titleOf(data), data: data as unknown as JsonValue });
    await refresh();
  }

  /** Reads a stored spreadsheet whole (to duplicate it, or to keep it for Undo before a delete). */
  async function read(id: string): Promise<SpreadsheetData | null> {
    const doc = await sdk.documents.get(id);
    return doc ? parseSpreadsheet(doc.data) : null;
  }

  async function remove(id: string): Promise<void> {
    await sdk.documents.delete(id);
    await refresh();
  }

  function open(id: string): Promise<DocumentHandle<SpreadsheetData>> {
    return openDocument(sdk, id, { parse: parseSpreadsheet, title: titleOf, debounceMs: 400 });
  }

  return {
    list,
    refresh,
    put,
    read,
    remove,
    open,
    dispose: () => stopWatching(),
  };
}

export type Spreadsheets = Awaited<ReturnType<typeof createSpreadsheets>>;
export type SpreadsheetHandle = DocumentHandle<SpreadsheetData>;
export type SpreadsheetChange = DocumentChangeEvent<SpreadsheetData>;
export { errorMessage };
