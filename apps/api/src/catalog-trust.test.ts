import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGUE_PUBLIC_KEY } from "./catalog-trust.ts";

describe("the catalogue key", () => {
  // The service and the app must check the signed lists against the same key.
  it("is the app's", () => {
    const app = readFileSync(new URL("../../desktop/src/main/safety-lists.ts", import.meta.url), "utf8");
    expect(/export const CATALOGUE_PUBLIC_KEY = "([^"]+)"/.exec(app)?.[1]).toBe(CATALOGUE_PUBLIC_KEY);
  });
});
