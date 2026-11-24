// The hotkeys of an item that is gone (deleted while the panel was closing, or before a crash) are let go when the
// panel starts: closing a panel can't remove them, since Tavora refuses calls from a page that is going.
import { expect, it, vi } from "vitest";
import { newItem, type ItemList } from "./items";
import { sweepHotkeys } from "./hotkey-sweep";

const list: ItemList = { items: [newItem("counter", "kept", "Deaths"), newItem("stopwatch", "run", "Run")] };

it("removes the hotkeys of items that are gone, once per item, and keeps the rest", async () => {
  const remove = vi.fn(async () => undefined);
  const hotkeys = {
    list: async () => [
      { action: "up", target: "kept" },
      { action: "up", target: "gone" },
      { action: "down", target: "gone" },
      { action: "start-pause", target: "run" },
      { action: "reset", target: "old" },
    ],
    remove,
  };
  expect(await sweepHotkeys(hotkeys, list)).toEqual(["gone", "old"]);
  expect(remove.mock.calls).toEqual([["gone"], ["old"]]);
});

it("never fails the start: a list or a removal that is refused changes nothing", async () => {
  await expect(sweepHotkeys({ list: async () => Promise.reject(new Error("no")), remove: vi.fn() }, list)).resolves.toEqual([]);
  const remove = vi.fn(async () => Promise.reject(new Error("refused")));
  await expect(sweepHotkeys({ list: async () => [{ action: "up", target: "gone" }], remove }, list)).resolves.toEqual(["gone"]);
});
