import { describe, expect, it } from "vitest";
import { Workbook } from "./formula/engine";
import { isError, isFormula } from "./formula/values";
import { buildLiveState, LIVE_DEFAULTS, LIVE_MAX, readLiveState } from "./live";
import { de, en } from "./locales";
import { parseSpreadsheet } from "./model";
import { buildTemplate, TEMPLATES, todaySerial } from "./templates";

describe("templates", () => {
  for (const [lang, catalog] of [["en", en], ["de", de]] as const) {
    for (const id of TEMPLATES) {
      it(`${id} in ${lang}: every formula works out, and it reads back as it was`, () => {
        const doc = buildTemplate(id, (key) => (catalog as Record<string, string>)[key] ?? key, "2026-11-04T00:00:00.000Z", todaySerial(new Date(2026, 10, 4)));
        expect(doc.name).toBe((catalog as Record<string, string>)[`tpl.${id}.name`]);
        const wb = new Workbook(doc.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, cells: sheet.cells })));
        for (const sheet of doc.sheets) {
          for (const [name, raw] of Object.entries(sheet.cells)) {
            if (!isFormula(raw)) continue;
            const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(name)!;
            const value = wb.value(sheet.id, Number(digits) - 1, letters!.charCodeAt(0) - 65);
            expect(isError(value), `${name} ${raw}`).toBe(false);
          }
        }
        expect(parseSpreadsheet(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
        if (id !== "blank") expect(doc.live).not.toBeNull();
      });
    }
  }
});

describe("live view", () => {
  it("stays under Tavora's limit, cutting rows with +N more", () => {
    const rows = Array.from({ length: 200 }, (_, row) => Array.from({ length: 20 }, (_, col) => ({ t: `Row ${row} column ${col} with a long text that goes on and on and on and on and on` })));
    const state = buildLiveState({ rows, widths: Array(20).fill(96), header: true, look: LIVE_DEFAULTS, moreText: "+{count} more" });
    expect(new TextEncoder().encode(JSON.stringify(state)).length).toBeLessThanOrEqual(LIVE_MAX.bytes);
    expect(state.rows[0]).toHaveLength(LIVE_MAX.cols);
    expect(state.rows.length + state.more).toBe(200);
    expect(state.rows[0]![0]!.t.length).toBeLessThanOrEqual(LIVE_MAX.text);
  });

  it("reads back only what it knows", () => {
    const state = readLiveState({ rows: [[{ t: "a", b: true, c: "info", f: "pink", k: "check", v: true }, "x"]], widths: [5000], look: { size: "huge" } });
    expect(state?.rows).toEqual([[{ t: "a", b: true, c: "info", k: "check", v: true }]]);
    expect(state?.widths).toEqual([800]);
    expect(state?.look).toEqual(LIVE_DEFAULTS);
    expect(readLiveState(null)).toBeNull();
  });
});
