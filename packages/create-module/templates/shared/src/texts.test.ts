import { catalogProblems } from "@tavora/sdk/testing";
import { expect, it } from "vitest";
import { TEXTS } from "./texts";

it("has every text in English and German", () => {
  expect(catalogProblems(TEXTS.en, TEXTS.de)).toEqual([]);
});
