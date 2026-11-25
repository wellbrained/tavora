import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { expect, it, vi } from "vitest";
import { LIST_ID, LIST_TITLE, parseList, shownAlign, shownFont } from "./items";
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

// A newer copy may add fields (the catalogue's, before a fallback to the shipped one): this version keeps them through an
// edit and its save, while what it reads itself is still checked.
it("keeps fields a newer version added when it changes and saves the list", async () => {
  const { sdk, host } = createMemoryHost();
  const newer: JsonValue = {
    theme: "dark",
    items: [
      { id: "c1", kind: "counter", label: "Deaths", value: 3, sound: "ding", links: [{ target: "c2", amount: 2, note: "x" }], look: { color: "#ffffff", glow: true, wordsColor: "red" }, stream: { key: "g1", whole: true, text: "", look: {}, place: "top" } },
      { id: "c2", kind: "counter", label: "Bosses", value: 1, links: [{ target: "c1", amount: 1 }] },
      { id: "k1", kind: "stopwatch", label: "Run", counted: 5000, lapBase: "nope", splitColor: "#00ff00" },
    ],
  };
  await host.documents.put({ id: LIST_ID, title: LIST_TITLE, data: newer });
  const store = await createItemStore(sdk, { debounceMs: 0 });
  store.apply(["c1"], (data) => void ((data.items[0] as { value: number }).value = 4));
  await store.flush();
  const saved = host.documents.get(LIST_ID)!.data as { theme: string; items: Record<string, unknown>[] };
  expect(saved.theme).toBe("dark");
  expect(saved.items[0]).toMatchObject({ value: 4, sound: "ding", links: [{ target: "c2", amount: 2, note: "x" }], look: { glow: true }, stream: { place: "top" } });
  // What this version reads is still checked: a bad colour and a bad lap base are not kept.
  expect((saved.items[0]!.look as Record<string, unknown>).wordsColor).toBeUndefined();
  expect(saved.items[2]).toMatchObject({ splitColor: "#00ff00" });
  expect(saved.items[2]!.lapBase).toBeUndefined();
  await store.dispose();
});

it("keeps items of a kind a newer version added, in their place, with the links to them", async () => {
  const { sdk, host } = createMemoryHost();
  const dice = { id: "d1", kind: "dice", label: "Roll", sides: 20 };
  const data: JsonValue = {
    items: [
      { id: "c1", kind: "counter", label: "Deaths", value: 1, links: [{ target: "d1", amount: 2 }] },
      dice,
      { id: "c2", kind: "counter", label: "Bosses", value: 0 },
    ],
  };
  await host.documents.put({ id: LIST_ID, title: LIST_TITLE, data });
  const store = await createItemStore(sdk, { debounceMs: 0 });
  expect(store.list.value.items.map((item) => item.id)).toEqual(["c1", "c2"]);
  store.apply(["c1"], (list) => {
    const counter = list.items[0]!;
    if (counter.kind === "counter") counter.value = 5;
  });
  await store.flush();
  const saved = host.documents.get(LIST_ID)!.data as { items: { id: string; links?: unknown }[] };
  expect(saved.items.map((item) => item.id)).toEqual(["c1", "d1", "c2"]);
  expect(saved.items[1]).toEqual(dice);
  expect(saved.items[0]!.links).toEqual([{ target: "d1", amount: 2 }]);
  await store.dispose();
});

it("keeps a font, an alignment and a time format a newer version added when an item is changed and saved", async () => {
  const { sdk, host } = createMemoryHost();
  const data: JsonValue = { items: [{ id: "k1", kind: "stopwatch", label: "Run", format: "{d}d {h}:{mm}", look: { font: "serif", align: "justify" } }] };
  await host.documents.put({ id: LIST_ID, title: LIST_TITLE, data });
  const store = await createItemStore(sdk, { debounceMs: 0 });
  const look = store.list.value.items[0]!.look;
  expect([shownFont(look.font), shownAlign(look.align)]).toEqual(["inter", "center"]);
  store.apply(["k1"], (list) => void (list.items[0]!.label = "Speedrun"));
  await store.flush();
  const saved = host.documents.get(LIST_ID)!.data as { items: { label: string; format: string; look: { font: string; align: string } }[] };
  expect(saved.items[0]).toMatchObject({ label: "Speedrun", format: "{d}d {h}:{mm}", look: { font: "serif", align: "justify" } });
  await store.dispose();
});
