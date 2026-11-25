import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { expect, it, vi } from "vitest";
import { createTodoStore } from "./store";
import { LIST_ID, LIST_TITLE, parseList, setGroupColor, shownColor } from "./todos";

vi.mock("@tavora/official-ui", async () => ({ ...(await import("../../shared/src/documents")), ...(await import("../../shared/src/i18n")), ...(await import("../../shared/src/use-document")) }));

// A list as an older version saved it (steps, a source link, a nameless group) with a colour a newer one added, opened and saved back.
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
            "color": "puce",
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

// A newer copy may add fields (the catalogue's, before a fallback to the shipped one): this version keeps them through an
// edit and its save, so nothing the newer one wrote is lost when it comes back.
it("keeps fields a newer version added when it changes and saves the list", async () => {
  const { sdk, host } = createMemoryHost();
  const newer: JsonValue = {
    version: 2,
    sort: "manual",
    groups: [{ id: "g1", name: "Run", color: "", icon: "flag", tasks: [{ id: "t1", title: "Boss", done: false, details: "", pinned: false, parentId: null, createdAt: "2026-11-01T00:00:00.000Z", doneAt: null, dueAt: "2026-12-01", tags: ["a"] }] }],
  };
  await host.documents.put({ id: LIST_ID, title: LIST_TITLE, data: newer });
  const store = await createTodoStore(sdk, { debounceMs: 0 });
  store.apply((data) => void (data.groups[0]!.tasks[0]!.title = "Boss fight"));
  await store.flush();
  const saved = host.documents.get(LIST_ID)!.data as { sort: string; groups: { icon: string; tasks: { title: string; dueAt: string; tags: string[] }[] }[] };
  expect(saved.sort).toBe("manual");
  expect(saved.groups[0]!.icon).toBe("flag");
  expect(saved.groups[0]!.tasks[0]).toMatchObject({ title: "Boss fight", dueAt: "2026-12-01", tags: ["a"] });
  await store.dispose();
});

it("still turns old steps into sub-to-dos once, without keeping the steps", () => {
  const once = parseList(OLD);
  expect(parseList(once as JsonValue)).toEqual(once);
  expect(JSON.stringify(once)).not.toContain('"steps"');
  expect(JSON.stringify(once)).not.toContain('"link"');
});

it("keeps a group colour a newer version added when the list is changed and saved", async () => {
  const { sdk, host } = createMemoryHost();
  await host.documents.put({ id: LIST_ID, title: LIST_TITLE, data: { version: 2, groups: [{ id: "g1", name: "Run", color: "gold", tasks: [] }, { id: "g2", name: "Loot", color: "", tasks: [] }] } });
  const parsed = parseList(host.documents.get(LIST_ID)!.data);
  expect(shownColor(parsed.groups[0]!.color)).toBe("");
  const store = await createTodoStore(sdk, { debounceMs: 0 });
  store.apply((list) => setGroupColor(list, "g2", "red"));
  await store.flush();
  const saved = host.documents.get(LIST_ID)!.data as { groups: { color: string }[] };
  expect(saved.groups.map((group) => group.color)).toEqual(["gold", "red"]);
  await store.dispose();
});
