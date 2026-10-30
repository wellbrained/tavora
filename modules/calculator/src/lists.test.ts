import { TavoraError, type JsonValue } from "@tavora/sdk";
import { createMemoryHost, type MemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { remember } from "./history";
import { createListsStore, LISTS_ID, LISTS_TITLE, parseLists, type Lists } from "./lists";
import { saveValue } from "./values";

// The shared package's index also brings in Vue components, which tests in Node can't load.
vi.mock("@tavora/official-ui", async () => ({ ...(await import("../../shared/src/documents")), ...(await import("../../shared/src/i18n")) }));

/** Two panels of the same module on one shared state. */
function twoPanels() {
  const a = createMemoryHost();
  const b = createMemoryHost({ share: a.host });
  return { a, b };
}

const stored = (host: MemoryHost) => parseLists((host.documents.get(LISTS_ID)?.data ?? null) as JsonValue | null);
const results = (lists: Lists) => lists.history.map((item) => item.result);

describe("parseLists", () => {
  it("makes empty lists of anything broken", () => {
    expect(parseLists(null)).toEqual({ history: [], values: [] });
    expect(parseLists([1] as unknown as JsonValue)).toEqual({ history: [], values: [] });
    expect(parseLists({ history: [{ expression: "1+1", result: "2" }, 3], values: "x" } as unknown as JsonValue).history).toHaveLength(1);
  });
});

describe("createListsStore", () => {
  it("shows a history change at once and saves it", async () => {
    const { a } = twoPanels();
    const store = await createListsStore(a.sdk);
    store.changeHistory((items) => remember(items, { expression: "1+1", result: "2" }));
    expect(store.history.value.map((item) => item.result)).toEqual(["2"]);
    await store.flush();
    expect(results(stored(a.host))).toEqual(["2"]);
  });

  it("keeps both panels' results and values when they change at the same time", async () => {
    const { a, b } = twoPanels();
    const first = await createListsStore(a.sdk);
    const second = await createListsStore(b.sdk);
    first.changeHistory((items) => remember(items, { expression: "1+1", result: "2" }));
    second.changeHistory((items) => remember(items, { expression: "2+2", result: "4" }));
    second.changeValues((items) => saveValue(items, { name: "iron", value: "40" }) ?? items);
    await Promise.all([first.flush(), second.flush()]);
    await vi.waitFor(() => expect(first.history.value.map((item) => item.result).sort()).toEqual(["2", "4"]));
    await vi.waitFor(() => expect(first.values.value.map((value) => value.name)).toEqual(["iron"]));
    expect(results(stored(a.host)).sort()).toEqual(["2", "4"]);
  });

  it("shows the other panel's change without a focus reload", async () => {
    const { a, b } = twoPanels();
    const first = await createListsStore(a.sdk);
    const second = await createListsStore(b.sdk);
    second.changeValues((items) => saveValue(items, { name: "wood", value: "7" }) ?? items);
    await second.flush();
    await vi.waitFor(() => expect(first.values.value).toEqual([{ name: "wood", value: "7" }]));
  });

  it("shows the stored lists again and says so when a save fails", async () => {
    const { a } = twoPanels();
    const store = await createListsStore(a.sdk);
    a.host.answer("documents.put", async () => {
      throw new TavoraError({ code: "INTERNAL", message: "disk full" });
    });
    store.changeValues((items) => saveValue(items, { name: "lost", value: "1" }) ?? items);
    expect(store.values.value).toHaveLength(1);
    await store.flush();
    await vi.waitFor(() => expect(store.values.value).toEqual([]));
    expect(store.error.value).toContain("disk full");
  });

  it("copies the old module storage lists in once", async () => {
    const { a, b } = twoPanels();
    await a.sdk.storage.set("history", [{ expression: "3*3", result: "9" }]);
    await a.sdk.storage.set("values", [{ name: "iron", value: "40" }]);
    const first = await createListsStore(a.sdk);
    expect(first.history.value).toEqual([{ expression: "3*3", result: "9" }]);
    expect(first.values.value).toEqual([{ name: "iron", value: "40" }]);
    expect(a.host.documents.get(LISTS_ID)?.title).toBe(LISTS_TITLE);
    // A second panel opening later reads the document, not the old keys again.
    first.changeHistory(() => []);
    await first.flush();
    const second = await createListsStore(b.sdk);
    expect(second.history.value).toEqual([]);
    expect(second.values.value).toEqual([{ name: "iron", value: "40" }]);
  });

  it("starts empty when there is nothing to copy", async () => {
    const { a } = twoPanels();
    const store = await createListsStore(a.sdk);
    expect(store.history.value).toEqual([]);
    expect(a.host.documents.get(LISTS_ID)).toBeNull();
  });
});
