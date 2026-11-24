import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { expect, it, vi } from "vitest";
import { LIST_ID, LIST_TITLE, parseList } from "./items";
import { createItemStore } from "./store";

vi.mock("@tavora/official-ui", async () => ({ ...(await import("../../shared/src/documents")), ...(await import("../../shared/src/i18n")), ...(await import("../../shared/src/use-document")) }));

// Items as older versions saved them: sparse fields, a stray link, a clock without laps, a broken entry.
const OLD: JsonValue = {
  items: [
    { id: "c1", kind: "counter", label: "Deaths", value: 3, links: [{ target: "c2", amount: 2 }, { target: "gone", amount: 1 }] },
    { id: "c2", kind: "counter", label: "Bosses", value: 1, step: 2, goal: 5 },
    { id: "k1", kind: "stopwatch", label: "Run", counted: 5000, lapTimes: [1, 2, "x"], lapBase: 100 },
    { id: "k2", kind: "countdown", label: "Break", duration: 60000, repeat: true },
    { id: "", kind: "counter" },
    { kind: "nope" },
  ],
};

it("saves a stored list back as the same document", async () => {
  const { sdk, host } = createMemoryHost();
  await host.documents.put({ id: LIST_ID, title: LIST_TITLE, data: OLD });
  const store = await createItemStore(sdk, { debounceMs: 0 });
  store.apply([], () => undefined);
  await store.flush();
  const saved = host.documents.get(LIST_ID)!;
  expect({ id: saved.id, title: saved.title, data: saved.data }).toMatchInlineSnapshot(`
    {
      "data": {
        "items": [
          {
            "goal": null,
            "id": "c1",
            "kind": "counter",
            "label": "Deaths",
            "links": [
              {
                "amount": 2,
                "target": "c2",
              },
            ],
            "look": {
              "align": "center",
              "color": "#ffffff",
              "font": "inter",
              "numberSize": "m",
              "numberStep": "m",
              "outline": true,
              "showLabel": true,
              "wordsSize": "xl",
              "wordsStep": "m",
            },
            "negative": false,
            "step": 1,
            "stream": null,
            "value": 3,
          },
          {
            "goal": 5,
            "id": "c2",
            "kind": "counter",
            "label": "Bosses",
            "links": [],
            "look": {
              "align": "center",
              "color": "#ffffff",
              "font": "inter",
              "numberSize": "m",
              "numberStep": "m",
              "outline": true,
              "showLabel": true,
              "wordsSize": "xl",
              "wordsStep": "m",
            },
            "negative": false,
            "step": 2,
            "stream": null,
            "value": 1,
          },
          {
            "counted": 5000,
            "doneText": "",
            "duration": 300000,
            "format": "m:ss",
            "id": "k1",
            "kind": "stopwatch",
            "label": "Run",
            "lapBase": 100,
            "lapTimes": [
              1,
              2,
            ],
            "laps": false,
            "look": {
              "align": "center",
              "color": "#ffffff",
              "font": "inter",
              "numberSize": "m",
              "numberStep": "m",
              "outline": true,
              "showLabel": true,
              "wordsSize": "xl",
              "wordsStep": "m",
            },
            "repeat": false,
            "showLastLap": false,
            "since": null,
          },
          {
            "counted": 0,
            "doneText": "",
            "duration": 60000,
            "format": "m:ss",
            "id": "k2",
            "kind": "countdown",
            "label": "Break",
            "lapTimes": [],
            "laps": false,
            "look": {
              "align": "center",
              "color": "#ffffff",
              "font": "inter",
              "numberSize": "m",
              "numberStep": "m",
              "outline": true,
              "showLabel": true,
              "wordsSize": "xl",
              "wordsStep": "m",
            },
            "repeat": true,
            "showLastLap": false,
            "since": null,
          },
        ],
      },
      "id": "items",
      "title": "Clocks and counters",
    }
  `);
  expect(parseList(saved.data as JsonValue)).toEqual(saved.data);
  await store.dispose();
});

it("creates the same document for a new list", async () => {
  const { sdk, host } = createMemoryHost();
  const store = await createItemStore(sdk, { debounceMs: 0 });
  await store.flush();
  expect(host.documents.get(LIST_ID)).toBeNull();
  store.apply([], () => undefined);
  await store.flush();
  const saved = host.documents.get(LIST_ID)!;
  expect({ id: saved.id, title: saved.title, data: saved.data }).toMatchInlineSnapshot(`
    {
      "data": {
        "items": [],
      },
      "id": "items",
      "title": "Clocks and counters",
    }
  `);
  await store.dispose();
});
