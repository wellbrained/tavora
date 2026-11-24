// A newer copy may add fields (the catalogue's, before a fallback to the shipped one): this version keeps them through
// a read and the save (the saver writes the board over what it read), so nothing the newer one wrote is lost.
import type { JsonValue } from "@tavora/sdk";
import { expect, it } from "vitest";
import { parseBoard } from "./boards";

it("keeps a newer version's fields on a board, and still checks its own", () => {
  const board = parseBoard({ version: 1, elements: [], name: "Plan", background: "url(x)", layers: [{ id: "l1" }] } as JsonValue);
  const saved = { ...board, elements: [{ id: "e1" }] };
  expect(JSON.parse(JSON.stringify(saved))).toMatchObject({ name: "Plan", layers: [{ id: "l1" }] });
  expect(board.background).not.toBe("url(x)");
});
