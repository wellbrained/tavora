import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { describe, expect, it, vi } from "vitest";
import { createTodoStore, keepSame } from "./store";
import { addTask, updateTask } from "./todos";

// The shared package's index also brings in Vue components, which tests in Node can't load.
vi.mock("@tavora/official-ui", async () => ({ ...(await import("../../shared/src/documents")), ...(await import("../../shared/src/i18n")) }));

describe("keepSame", () => {
  it("gives back the old value when nothing changed", () => {
    const previous = { groups: [{ id: "g", tasks: [{ id: "a", done: false }] }] };
    expect(keepSame(previous, structuredClone(previous))).toBe(previous);
  });

  it("keeps the parts that did not change", () => {
    const previous = { groups: [{ id: "g", tasks: [{ id: "a", done: false }, { id: "b", done: false }] }], other: [1] };
    const next = structuredClone(previous);
    next.groups[0]!.tasks[1]!.done = true;
    const kept = keepSame(previous, next);
    expect(kept).toEqual(next);
    expect(kept).not.toBe(previous);
    expect(kept.other).toBe(previous.other);
    expect(kept.groups[0]!.tasks[0]).toBe(previous.groups[0]!.tasks[0]);
    expect(kept.groups[0]!.tasks[1]).not.toBe(previous.groups[0]!.tasks[1]);
  });

  it("sees added, removed and reordered items", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(keepSame([a, b], [{ id: "b" }, { id: "a" }])).toEqual([b, a]);
    expect(keepSame([a], [{ id: "a" }, { id: "b" }])).toEqual([a, b]);
    expect(keepSame([a, b], [{ id: "a" }])).toEqual([a]);
    expect(keepSame({ x: 1, y: 2 }, { x: 1 } as { x: number; y?: number })).toEqual({ x: 1 });
    expect(keepSame({ x: 1 } as { x: number; y?: number }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
});

/** Just enough of the SDK for the store: one document, saved at once. */
function fakeSdk(): TavoraSDK {
  let doc: { data: JsonValue; revision: number } | null = null;
  return {
    documents: {
      get: async () => (doc ? { id: "list", title: "", ...doc } : null),
      put: async ({ data }: { data: JsonValue }) => {
        doc = { data: structuredClone(data), revision: (doc?.revision ?? 0) + 1 };
        return { revision: doc.revision, updatedAt: new Date().toISOString() };
      },
    },
  } as unknown as TavoraSDK;
}

describe("createTodoStore", () => {
  it("keeps the list it shows when a save comes back unchanged", async () => {
    const store = createTodoStore(fakeSdk());
    await store.load();
    await store.apply((data) => addTask(data, null, { id: "a", title: "Find the Ancient Crypt", createdAt: "2026-10-19T07:00:00.000Z", parentId: null }, "g"));
    const shown = store.list.value;
    const saving = store.apply((data) => updateTask(data, "a", { title: "Find the Old Crypt" }));
    const edited = store.list.value;
    expect(edited).not.toBe(shown);
    await saving;
    expect(store.list.value).toBe(edited);
    await store.reload();
    expect(store.list.value).toBe(edited);
  });
});
