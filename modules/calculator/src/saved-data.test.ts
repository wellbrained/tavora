import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { expect, it, vi } from "vitest";
import { createListsStore, LISTS_ID, LISTS_TITLE, parseLists } from "./lists";

vi.mock("@tavora/official-ui", async () => ({ ...(await import("../../shared/src/documents")), ...(await import("../../shared/src/i18n")), ...(await import("../../shared/src/use-document")) }));

const snapshot = (host: ReturnType<typeof createMemoryHost>["host"]) => {
  const saved = host.documents.get(LISTS_ID)!;
  return { id: saved.id, title: saved.title, data: saved.data };
};

it("saves a stored document back the same, broken entries dropped and a newer version's fields kept", async () => {
  const { sdk, host } = createMemoryHost();
  await host.documents.put({
    id: LISTS_ID,
    title: LISTS_TITLE,
    data: { history: [{ expression: "1+1", result: "2" }, 3], values: [{ name: "iron", value: "40" }, "x"], extra: true },
  });
  const store = await createListsStore(sdk);
  store.changeHistory((items) => items);
  await store.flush();
  expect(snapshot(host)).toMatchInlineSnapshot(`
    {
      "data": {
        "extra": true,
        "history": [
          {
            "expression": "1+1",
            "result": "2",
          },
        ],
        "values": [
          {
            "name": "iron",
            "value": "40",
          },
        ],
      },
      "id": "lists",
      "title": "Calculator history and values",
    }
  `);
  expect(parseLists(snapshot(host).data as JsonValue)).toEqual(snapshot(host).data);
  await store.dispose();
});

it("copies the old module storage lists into the same document", async () => {
  const { sdk, host } = createMemoryHost();
  await sdk.storage.set("history", [{ expression: "3*3", result: "9" }]);
  await sdk.storage.set("values", [{ name: "iron", value: "40" }]);
  const store = await createListsStore(sdk);
  expect(snapshot(host)).toMatchInlineSnapshot(`
    {
      "data": {
        "history": [
          {
            "expression": "3*3",
            "result": "9",
          },
        ],
        "values": [
          {
            "name": "iron",
            "value": "40",
          },
        ],
      },
      "id": "lists",
      "title": "Calculator history and values",
    }
  `);
  store.changeValues((items) => items);
  await store.flush();
  expect(snapshot(host)).toMatchInlineSnapshot(`
    {
      "data": {
        "history": [
          {
            "expression": "3*3",
            "result": "9",
          },
        ],
        "values": [
          {
            "name": "iron",
            "value": "40",
          },
        ],
      },
      "id": "lists",
      "title": "Calculator history and values",
    }
  `);
  await store.dispose();
});

it("creates the same document for new lists", async () => {
  const { sdk, host } = createMemoryHost();
  const store = await createListsStore(sdk);
  expect(host.documents.get(LISTS_ID)).toBeNull();
  store.changeValues((items) => items);
  await store.flush();
  expect(snapshot(host)).toMatchInlineSnapshot(`
    {
      "data": {
        "history": [],
        "values": [],
      },
      "id": "lists",
      "title": "Calculator history and values",
    }
  `);
  await store.dispose();
});
