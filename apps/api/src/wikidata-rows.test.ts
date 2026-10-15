import { describe, expect, it } from "vitest";
import { collectWikidata, type WikidataRow } from "./wikidata-rows.ts";

const row = (qid: string, label: string, lang: string, appid: number, alts = ""): WikidataRow => ({
  item: { value: `http://www.wikidata.org/entity/${qid}` },
  label: { value: label },
  lang: { value: lang },
  appid: { value: String(appid) },
  ...(alts ? { alts: { value: alts } } : {}),
});

describe("collectWikidata", () => {
  it("reads games whose name is stored as a mul label, like Elden Ring", () => {
    const games = collectWikidata([row("Q64826862", "Elden Ring", "mul", 1245620)]);
    expect(games.get("Q64826862")).toEqual({ qid: "Q64826862", label: "Elden Ring", aliases: [], steamAppId: 1245620 });
  });

  it("prefers the English label whichever row comes first", () => {
    const mulFirst = collectWikidata([row("Q1", "Portal", "mul", 400), row("Q1", "Portal (video game)", "en", 400)]);
    const enFirst = collectWikidata([row("Q1", "Portal (video game)", "en", 400), row("Q1", "Portal", "mul", 400)]);
    expect(mulFirst.get("Q1")!.label).toBe("Portal (video game)");
    expect(enFirst.get("Q1")!.label).toBe("Portal (video game)");
  });

  it("splits aliases and skips rows that are not usable", () => {
    const games = collectWikidata([
      row("Q2", "Doom", "mul", 379720, "DOOM 2016|Doom (2016)"),
      row("Q3", "  ", "en", 5),
      row("Q4", "Bad", "en", 0),
      row("not-an-item", "Bad", "en", 7),
    ]);
    expect([...games.keys()]).toEqual(["Q2"]);
    expect(games.get("Q2")!.aliases).toEqual(["DOOM 2016", "Doom (2016)"]);
  });
});
