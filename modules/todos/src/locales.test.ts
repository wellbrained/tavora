import { describe, expect, it } from "vitest";
import { de, en } from "./locales";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const keys = Object.keys(en) as (keyof typeof en)[];

describe("locales", () => {
  it("define the same keys in English and German, none empty", () => {
    expect(Object.keys(de).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(de[key].trim(), key).not.toBe("");
  });

  it("use the same {placeholders} in both languages", () => {
    for (const key of keys) expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
  });

  it("have .one and .other together", () => {
    for (const key of keys) {
      if (key.endsWith(".one")) expect(keys, key).toContain(key.replace(/\.one$/, ".other"));
      if (key.endsWith(".other")) expect(keys, key).toContain(key.replace(/\.other$/, ".one"));
    }
  });
});
