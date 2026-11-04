// @vitest-environment jsdom
import { createMemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Lang } from "./formula/locale";
import { LIMITS, documentBytes, newSpreadsheet, parseSpreadsheet, type SpreadsheetData } from "./model";
import { createSession } from "./session";
import { createSpreadsheets } from "./store";

const texts = () => ({ yes: "TRUE", no: "FALSE" });

async function twoPanels() {
  const a = createMemoryHost();
  const b = createMemoryHost({ share: a.host });
  const listA = await createSpreadsheets(a.sdk);
  const data = newSpreadsheet("Farm", "Sheet1", "2026-11-04T00:00:00.000Z");
  data.sheets[0]!.cells = { A1: "1", B1: "2" };
  await listA.put("sheet-1", data);
  const listB = await createSpreadsheets(b.sdk);
  const handleA = await listA.open("sheet-1");
  const handleB = await listB.open("sheet-1");
  const lang = ref<Lang>("en");
  return { a, b, handleA, handleB, one: createSession(handleA, { lang, texts }), two: createSession(handleB, { lang, texts }), lang, listA, listB };
}

const stored = (host: ReturnType<typeof createMemoryHost>["host"]) => parseSpreadsheet(host.documents.get("sheet-1")!.data);
const settle = async (...flushes: { flush(): Promise<void> }[]) => {
  for (let round = 0; round < 3; round++) for (const handle of flushes) await handle.flush();
};

describe("two panels on one spreadsheet", () => {
  it("both keep their edits to different cells", async () => {
    const { a, handleA, handleB, one, two } = await twoPanels();
    one.commit(0, 0, "10");
    two.commit(0, 1, "20");
    await settle(handleA, handleB);
    expect(stored(a.host).sheets[0]!.cells).toEqual({ A1: "10", B1: "20" });
    expect(one.valueAt(0, 1)).toBe(20);
    expect(two.valueAt(0, 0)).toBe(10);
  });

  it("undo after the other panel changed the same cell keeps the newer value and says so", async () => {
    const { a, handleA, handleB, one, two } = await twoPanels();
    one.commit(0, 0, "10");
    one.commit(1, 0, "11");
    await settle(handleA, handleB);
    two.commit(0, 0, "99");
    await settle(handleB, handleA);
    expect(one.valueAt(0, 0)).toBe(99);
    // Undo the second edit: it is untouched elsewhere and goes back.
    expect(one.undo()).toBeNull();
    expect(one.rawAt(1, 0)).toBeUndefined();
    // Undo the first: the other panel's 99 stays.
    expect(one.undo()).toEqual({ kind: "kept", count: 1 });
    await settle(handleA, handleB);
    expect(stored(a.host).sheets[0]!.cells.A1).toBe("99");
  });

  it("undoes an inserted row whole or not at all when the other panel changed a moved cell", async () => {
    const { handleA, handleB, one, two } = await twoPanels();
    one.commit(2, 0, "=A1+B1");
    one.shift("row", 0, 1);
    await settle(handleA, handleB);
    expect(two.rawAt(1, 0)).toBe("1");
    two.commit(1, 0, "7");
    await settle(handleB, handleA);
    const now = structuredClone(one.doc.value);
    expect(one.undo()).toEqual({ kind: "blocked" });
    expect(one.doc.value).toEqual(now);
    expect(one.rawAt(3, 0)).toBe("=A2+B2");
    // The step is gone. The edit before it was at A3, which the row moved to A4: it says so and leaves it.
    expect(one.undo()).toEqual({ kind: "kept", count: 1 });
    expect(one.rawAt(3, 0)).toBe("=A2+B2");
    expect(one.canUndo.value).toBe(false);
  });

  it("brings a deleted sheet back whole from its toast, or says it can't", async () => {
    const { one } = await twoPanels();
    one.addNewSheet("g", "Sheet");
    one.commit(0, 0, "21");
    const changes = one.removeSheet("g")!;
    expect(one.revert(changes)).toBe(true);
    expect(one.valueAt(0, 0, "g")).toBe(21);
    const again = one.removeSheet("g")!;
    one.addNewSheet("g", "Sheet");
    expect(one.revert(again)).toBe(false);
  });

  it("follows a sheet added and renamed in the other panel", async () => {
    const { handleA, handleB, one, two } = await twoPanels();
    one.commit(0, 2, "=Gear!A1*2");
    two.addNewSheet("g", "Sheet");
    two.renameSheet("g", "Gear");
    two.commit(0, 0, "21");
    await settle(handleB, handleA);
    expect(one.valueAt(0, 2)).toBe(42);
  });
});

describe("the 4 MB limit", () => {
  /** A spreadsheet a few bytes under the limit, open in one panel. */
  async function nearlyFull(margin: number) {
    const a = createMemoryHost();
    const list = await createSpreadsheets(a.sdk);
    const data = newSpreadsheet("Full", "Sheet1", "2026-11-04T00:00:00.000Z");
    data.sheets[0]!.cells = { A1: "" };
    const size = documentBytes(data);
    data.sheets[0]!.cells.A1 = "x".repeat(LIMITS.bytes - size - margin);
    await list.put("sheet-1", data);
    const handle = await list.open("sheet-1");
    const told: unknown[] = [];
    const session = createSession(handle, { lang: ref<Lang>("en"), texts, refused: (refusal) => told.push(refusal) });
    return { a, handle, session, told };
  }

  it("refuses every change that would go over it, before anything changes", async () => {
    const { a, handle, session, told } = await nearlyFull(20);
    const start = structuredClone(session.doc.value);
    session.commit(0, 1, "a text longer than the few bytes that are left");
    expect(session.fill({ source: { top: 0, left: 0, bottom: 0, right: 0 }, target: { top: 1, left: 0, bottom: 3, right: 0 }, direction: "down" }, "copy")).toEqual({ kind: "tooBig", limit: "bytes" });
    session.styleRange({ top: 0, left: 0, bottom: 99, right: 25 }, { bold: true, color: "info" });
    session.formatRange({ top: 0, left: 0, bottom: 99, right: 25 }, { type: "dropdown", options: [{ value: "Gold", color: "warning" }] });
    expect(session.paste({ row: 5, col: 5 }, { top: 5, left: 5, bottom: 5, right: 5 }, { rows: [[{ text: "a longer text than fits" }]], from: null })).toEqual({ kind: "tooBig", limit: "bytes" });
    expect(session.addNewSheet("x", "Sheet")).toEqual({ kind: "tooBig", limit: "bytes" });
    expect(told).toHaveLength(6);
    expect(told.every((refusal) => JSON.stringify(refusal) === JSON.stringify({ kind: "tooBig", limit: "bytes" }))).toBe(true);
    expect(session.doc.value).toEqual(start);
    expect(session.canUndo.value).toBe(false);
    expect(session.sheetId.value).toBe("s1");
    await handle.flush();
    expect(parseSpreadsheet(a.host.documents.get("sheet-1")!.data)).toEqual(start);
  });

  it("lets through what still fits", async () => {
    const { session, told } = await nearlyFull(400);
    session.commit(0, 1, "fits");
    session.styleRange({ top: 0, left: 0, bottom: 0, right: 0 }, { bold: true });
    expect(told).toEqual([]);
    expect(session.rawAt(0, 1)).toBe("fits");
  });
});

describe("one panel", () => {
  it("saves what is pending when the panel goes", async () => {
    const { a, handleA, one } = await twoPanels();
    one.commit(2, 2, "kept");
    await handleA.dispose();
    expect(stored(a.host).sheets[0]!.cells.C3).toBe("kept");
  });

  it("stores German input without the language, and switching it changes nothing stored", async () => {
    const { a, handleA, one, lang } = await twoPanels();
    lang.value = "de";
    one.commit(0, 0, "1,5");
    one.commit(1, 0, "=ROUND(A1*3;0)");
    one.commit(2, 0, "=ROUND(A1,2)");
    await settle(handleA);
    expect(stored(a.host).sheets[0]!.cells).toMatchObject({ A1: "1.5", A2: "=ROUND(A1*3,0)", A3: "=ROUND(A1,2)" });
    expect(one.shownAt(0, 0)).toBe("1,5");
    expect(one.editTextAt(1, 0)).toBe("=ROUND(A1*3;0)");
    lang.value = "en";
    expect(one.shownAt(0, 0)).toBe("1.5");
    expect(one.editTextAt(1, 0)).toBe("=ROUND(A1*3,0)");
    expect(stored(a.host).sheets[0]!.cells.A1).toBe("1.5");
  });

  it("grows the sheet on a big paste and refuses one past the limits without changing anything", async () => {
    const { one } = await twoPanels();
    expect(one.paste({ row: 150, col: 0 }, { top: 150, left: 0, bottom: 150, right: 0 }, { rows: [[{ text: "a" }, { text: "1.5" }]], from: null })).toBeNull();
    expect(one.used.value.rows).toBe(151);
    expect(one.valueAt(150, 1)).toBe(1.5);
    const before = structuredClone(one.doc.value);
    expect(one.paste({ row: 19_999, col: 0 }, { top: 19_999, left: 0, bottom: 19_999, right: 0 }, { rows: [[{ text: "a" }], [{ text: "b" }]], from: null })).toEqual({ kind: "tooBig", limit: "rows" });
    expect(one.paste({ row: 0, col: 199 }, { top: 0, left: 199, bottom: 0, right: 199 }, { rows: [[{ text: "a" }, { text: "b" }]], from: null })).toEqual({ kind: "tooBig", limit: "cols" });
    expect(one.doc.value).toEqual(before);
  });

  it("moves formulas pasted from another Tavora panel", async () => {
    const { one } = await twoPanels();
    one.paste({ row: 4, col: 3 }, { top: 4, left: 3, bottom: 4, right: 3 }, { rows: [[{ raw: "=A1+$B$1" }]], from: { top: 0, left: 2 } });
    expect(one.rawAt(4, 3)).toBe("=B5+$B$1");
  });

  it("undoes inserted rows, deleted sheets and sorts exactly", async () => {
    const { one } = await twoPanels();
    const start = structuredClone(one.doc.value) as SpreadsheetData;
    one.commit(2, 0, "=A1+B1");
    one.shift("row", 0, 2);
    expect(one.rawAt(4, 0)).toBe("=A3+B3");
    one.addNewSheet("x", "Sheet");
    one.commit(0, 0, "=Sheet1!A3");
    one.sheetId.value = "s1";
    expect(one.removeSheet("x")).not.toBeNull();
    one.sort({ top: 0, left: 0, bottom: 0, right: 0 }, [{ col: 0, descending: true }]);
    while (one.canUndo.value) expect(one.undo()).toBeNull();
    expect(one.doc.value).toEqual(start);
    while (one.canRedo.value) one.redo();
    expect(one.doc.value.sheets).toHaveLength(1);
  });

  it("shows a loop as #CYCLE! with the cells named, and recovers", async () => {
    const { one } = await twoPanels();
    one.commit(0, 0, "=B1+1");
    one.commit(0, 1, "=A1");
    expect(one.shownAt(0, 0)).toBe("#CYCLE!");
    expect(one.loopAt(0, 0)).toEqual(["A1", "B1"]);
    one.commit(0, 1, "5");
    expect(one.shownAt(0, 0)).toBe("6");
  });

  it("ticks checkboxes with Space, and filters rows by them", async () => {
    const { one } = await twoPanels();
    one.paste({ row: 0, col: 0 }, { top: 0, left: 0, bottom: 0, right: 0 }, { rows: [[{ text: "Item" }, { text: "Done" }], [{ text: "Iron" }, { text: "" }], [{ text: "Wood" }, { text: "" }]], from: null });
    one.formatRange({ top: 1, left: 1, bottom: 2, right: 1 }, { type: "checkbox" });
    one.toggleChecks({ top: 1, left: 1, bottom: 1, right: 1 }, { row: 1, col: 1 });
    expect(one.valueAt(1, 1)).toBe(true);
    one.toggleFilter();
    one.setColumnFilter(1, { hidden: [], contains: "", min: null, max: null, checked: true });
    expect([...one.hidden.value]).toEqual([2]);
    expect(one.sheet.value.header).toBe(true);
    one.setColumnFilter(1, { hidden: [], contains: "", min: null, max: null, checked: false });
    expect([...one.hidden.value]).toEqual([1]);
    one.clearFilter();
    expect([...one.hidden.value]).toEqual([]);
  });
});
