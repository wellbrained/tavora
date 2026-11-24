// A newer copy may add fields (the catalogue's, before a fallback to the shipped one): this version keeps them through
// a read, an edit and the save, so nothing the newer one wrote is lost when it comes back.
import type { JsonValue } from "@tavora/sdk";
import { expect, it } from "vitest";
import { parseLists } from "./lists";
import { parseSettings } from "./settings";
import { renameValue } from "./values";

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

it("keeps a newer version's fields in the lists", () => {
  const lists = parseLists({ pinned: ["a"], history: [{ expression: "1+1", result: "2", at: 5 }], values: [{ name: "Iron", value: "4", unit: "kg" }] } as JsonValue);
  lists.values = renameValue(lists.values, "Iron", "Ore")!;
  expect(roundTrip(lists)).toMatchObject({ pinned: ["a"], history: [{ at: 5 }], values: [{ name: "Ore", unit: "kg" }] });
});

it("keeps a newer version's settings, and still checks its own", () => {
  const settings = parseSettings({ mode: "nope", theme: "paper" } as JsonValue);
  expect(roundTrip({ ...settings })).toMatchObject({ mode: "plus", theme: "paper" });
});
