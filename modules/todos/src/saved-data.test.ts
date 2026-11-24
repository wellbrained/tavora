import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { expect, it, vi } from "vitest";
import { createTodoStore } from "./store";
import { LIST_ID, LIST_TITLE, parseList } from "./todos";

vi.mock("@tavora/official-ui", async () => ({ ...(await import("../../shared/src/documents")), ...(await import("../../shared/src/i18n")), ...(await import("../../shared/src/use-document")) }));

// A list as an older version saved it (steps, a source link, an unknown colour, a nameless group), opened and saved back.
const OLD: JsonValue = {
  groups: [
    { id: "g1", name: "", color: "puce", tasks: [{ id: "t1", title: "Old task", done: true, createdAt: "2026-01-01T00:00:00.000Z", link: "https://example.com", steps: [{ id: "s1", title: "Step", done: false }] }] },
    { id: "g2", name: "Second", color: "", tasks: [] },
  ],
};

it("saves a stored list back as the same document", async () => {
  const { sdk, host } = createMemoryHost();
  await host.documents.put({ id: LIST_ID, title: LIST_TITLE, data: OLD });
  const store = await createTodoStore(sdk, { debounceMs: 0 });
  store.apply(() => undefined);
  await store.flush();
  const saved = host.documents.get(LIST_ID)!;
  expect({ id: saved.id, title: saved.title, data: saved.data }).toMatchInlineSnapshot(`
    {
      "data": {
        "groups": [
          {
            "color": "",
            "id": "g1",
            "name": "To-Dos",
            "tasks": [
              {
                "createdAt": "2026-01-01T00:00:00.000Z",
                "details": "https://example.com",
                "done": true,
                "doneAt": null,
                "id": "t1",
                "parentId": null,
                "pinned": false,
                "title": "Old task",
              },
              {
                "createdAt": "2026-01-01T00:00:00.000Z",
                "details": "",
                "done": false,
                "doneAt": null,
                "id": "s1",
                "parentId": "t1",
                "pinned": false,
                "title": "Step",
              },
            ],
          },
          {
            "color": "",
            "id": "g2",
            "name": "Second",
            "tasks": [],
          },
        ],
        "version": 2,
      },
      "id": "todos",
      "title": "To-Dos",
    }
  `);
  expect(parseList(saved.data as JsonValue)).toEqual(saved.data);
  await store.dispose();
});

it("saves nothing before an edit and creates the same document for a new list", async () => {
  const { sdk, host } = createMemoryHost();
  const store = await createTodoStore(sdk, { debounceMs: 0 });
  await store.flush();
  expect(host.documents.get(LIST_ID)).toBeNull();
  store.apply(() => undefined);
  await store.flush();
  const saved = host.documents.get(LIST_ID)!;
  expect({ id: saved.id, title: saved.title, data: saved.data }).toMatchInlineSnapshot(`
    {
      "data": {
        "groups": [],
        "version": 2,
      },
      "id": "todos",
      "title": "To-Dos",
    }
  `);
  await store.dispose();
});
