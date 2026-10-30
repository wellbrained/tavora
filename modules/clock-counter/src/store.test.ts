import { TavoraError, type JsonValue } from "@tavora/sdk";
import { createMemoryHost, type MemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { insert, LIST_ID, LIST_TITLE, newItem, parseList, startPause, find, count, type ItemList } from "./items";
import { createItemStore } from "./store";

// The shared package's index also brings in Vue components, which tests in Node can't load.
vi.mock("@tavora/official-ui", async () => ({ ...(await import("../../shared/src/documents")), ...(await import("../../shared/src/i18n")) }));

/** Two panels of the same module on one shared document state. */
function twoPanels() {
  const a = createMemoryHost();
  const b = createMemoryHost({ share: a.host });
  return { a, b };
}

const seed = (host: MemoryHost, data: JsonValue) => host.documents.put({ id: LIST_ID, title: LIST_TITLE, data });
const labels = (list: ItemList) => list.items.map((item) => item.label);
const stored = (host: MemoryHost) => parseList(host.documents.get(LIST_ID)?.data as JsonValue);

describe("createItemStore", () => {
  it("shows a change at once and saves it", async () => {
    const { a } = twoPanels();
    const store = await createItemStore(a.sdk);
    store.apply(["x"], (data) => insert(data, newItem("counter", "x", "Deaths")));
    expect(labels(store.list.value)).toEqual(["Deaths"]);
    await store.flush();
    expect(labels(stored(a.host))).toEqual(["Deaths"]);
  });

  it("shows the other panel's change", async () => {
    const { a, b } = twoPanels();
    const store = await createItemStore(a.sdk);
    const other = await createItemStore(b.sdk);
    other.apply(["y"], (data) => insert(data, newItem("stopwatch", "y", "Run")));
    await other.flush();
    await vi.waitFor(() => expect(labels(store.list.value)).toEqual(["Run"]));
  });

  it("keeps both edits when two panels change the list at the same time", async () => {
    const { a, b } = twoPanels();
    const store = await createItemStore(a.sdk);
    const other = await createItemStore(b.sdk);
    store.apply(["one"], (data) => insert(data, newItem("counter", "one", "One")));
    other.apply(["two"], (data) => insert(data, newItem("counter", "two", "Two")));
    await Promise.all([store.flush(), other.flush()]);
    await vi.waitFor(() => expect(labels(store.list.value).sort()).toEqual(["One", "Two"]));
    await vi.waitFor(() => expect(labels(other.list.value).sort()).toEqual(["One", "Two"]));
    expect(labels(stored(a.host)).sort()).toEqual(["One", "Two"]);
  });

  it("shows the stored list again and says so when a save fails", async () => {
    const { a } = twoPanels();
    seed(a.host, parseList(null) as unknown as JsonValue);
    const store = await createItemStore(a.sdk);
    a.host.answer("documents.put", async () => {
      throw new TavoraError({ code: "INTERNAL", message: "disk full" });
    });
    store.apply(["x"], (data) => insert(data, newItem("counter", "x", "Lost")));
    expect(labels(store.list.value)).toEqual(["Lost"]);
    await store.flush();
    await vi.waitFor(() => expect(labels(store.list.value)).toEqual([]));
    expect(store.error.value).toContain("disk full");
    expect(a.host.overlays).toEqual({});
  });

  it("tells the overlay of a changed item after the save, and only that item", async () => {
    const { a } = twoPanels();
    const store = await createItemStore(a.sdk);
    store.apply(["x", "y"], (data) => {
      insert(data, newItem("counter", "x", "Deaths"));
      insert(data, newItem("counter", "y", "Kills"));
    });
    await store.flush();
    await vi.waitFor(() => expect(Object.keys(a.host.overlays).sort()).toEqual(["x", "y"]));
    store.apply(["x"], (data) => count(data, "x", 1));
    await store.flush();
    await vi.waitFor(() => expect(a.host.overlays.x).toMatchObject({ kind: "counter", value: 1 }));
    expect(a.host.overlays.y).toMatchObject({ value: 0 });
  });

  it("removes the overlay of a deleted item", async () => {
    const { a } = twoPanels();
    const store = await createItemStore(a.sdk);
    store.apply(["x"], (data) => insert(data, newItem("counter", "x", "Deaths")));
    await store.flush();
    await vi.waitFor(() => expect(a.host.overlays.x).toBeDefined());
    store.apply(["x"], (data) => void (data.items = data.items.filter((item) => item.id !== "x")));
    await store.flush();
    await vi.waitFor(() => expect(a.host.overlays.x).toBeUndefined());
  });

  it("keeps a running clock's start time across panels", async () => {
    const { a, b } = twoPanels();
    const store = await createItemStore(a.sdk);
    const other = await createItemStore(b.sdk);
    store.apply(["c"], (data) => insert(data, newItem("stopwatch", "c", "Run")));
    await store.flush();
    await vi.waitFor(() => expect(labels(other.list.value)).toEqual(["Run"]));
    store.apply(["c"], (data) => {
      const clock = find(data, "c");
      if (clock && clock.kind !== "counter") startPause(clock, 1000);
    });
    await store.flush();
    await vi.waitFor(() => expect((find(other.list.value, "c") as { since: number | null }).since).toBe(1000));
  });
});
