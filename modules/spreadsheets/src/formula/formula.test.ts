import { describe, expect, it } from "vitest";
import { Workbook, type SheetCells } from "./engine";
import { formulaToShown, formulaToStored, looksEnglish } from "./locale";
import { dropSheetReferences, moveFormula, renameSheetReferences, shiftReferences } from "./rewrite";
import { dateSerial, err, type Scalar } from "./values";

const sheet = (id: string, cells: Record<string, string>, name = id): SheetCells => ({ id, name, cells });
const book = (cells: Record<string, string>, more: SheetCells[] = []) => new Workbook([sheet("s1", cells, "Sheet1"), ...more], { now: () => dateSerial(2026, 11, 4, 12, 0) });
const calc = (formula: string, cells: Record<string, string> = {}): Scalar => book({ ...cells, Z99: formula }).value("s1", 98, 25);

describe("operators", () => {
  it("follow Excel's order", () => {
    expect(calc("=1+2*3")).toBe(7);
    expect(calc("=(1+2)*3")).toBe(9);
    expect(calc("=2^3^2")).toBe(64);
    expect(calc("=-2^2")).toBe(4);
    expect(calc("=50%*10")).toBe(5);
    expect(calc('="a"&1+1')).toBe("a2");
    expect(calc("=1+1=2")).toBe(true);
    expect(calc('="abc"="ABC"')).toBe(true);
    expect(calc("=3<>3")).toBe(false);
  });

  it("give errors for bad sums", () => {
    expect(calc("=1/0")).toEqual(err("#DIV/0!"));
    expect(calc('="x"+1')).toEqual(err("#VALUE!"));
    expect(calc("=NOPE(1)")).toEqual(err("#NAME?"));
    expect(calc("=1+")).toEqual(err("#NAME?"));
    expect(calc("=Missing!A1")).toEqual(err("#REF!"));
    expect(calc("=A1:A3")).toEqual(err("#VALUE!"));
  });

  it("read empty cells as 0 and numbers typed as text", () => {
    expect(calc("=A1+1")).toBe(1);
    expect(calc("=A1")).toBe(0);
    expect(calc("=A1*2", { A1: "'4" })).toBe(8);
  });
});

describe("functions", () => {
  const cells = { A1: "4", A2: "6", A3: "text", A4: "", B1: "Iron", B2: "Copper", B3: "Iron ore", C1: "10", C2: "20", C3: "30" };
  const cases: [string, Scalar][] = [
    ["=SUM(A1:A4)", 10],
    ["=SUM(A1,A2,5)", 15],
    ["=AVERAGE(A1:A3)", 5],
    ["=MIN(A1:A3)", 4],
    ["=MAX(A1:A3)", 6],
    ["=COUNT(A1:A4)", 2],
    ["=COUNTA(A1:A4)", 3],
    ['=COUNTIF(B1:B3,"Iron*")', 2],
    ['=COUNTIF(A1:A3,">4")', 1],
    ['=SUMIF(B1:B3,"Iron",C1:C3)', 10],
    ['=AVERAGEIF(B1:B3,"<>Copper",C1:C3)', 20],
    ["=ROUND(2.345,2)", 2.35],
    ["=ROUND(1.005,2)", 1.01],
    ["=ROUND(-2.5,0)", -3],
    ["=ROUNDUP(2.301,1)", 2.4],
    ["=ROUNDDOWN(-2.39,1)", -2.3],
    ["=ABS(-3)", 3],
    ["=FLOOR(7,5)", 5],
    ["=CEILING(7,5)", 10],
    ['=IF(A1>5,"big","small")', "small"],
    ["=IF(A1>5,1/0,2)", 2],
    ['=IFS(A1>5,"a",A1>3,"b")', "b"],
    ["=IFS(A1>5,1)", err("#N/A")],
    ['=IFERROR(1/0,"none")', "none"],
    ["=AND(TRUE,A1>3)", true],
    ["=OR(FALSE,A1>5)", false],
    ["=NOT(A1>5)", true],
    ["=VLOOKUP(\"Copper\",B1:C3,2,FALSE)", 20],
    ["=VLOOKUP(\"Gold\",B1:C3,2,FALSE)", err("#N/A")],
    ['=XLOOKUP("Iron ore",B1:B3,C1:C3)', 30],
    ['=XLOOKUP("Gold",B1:B3,C1:C3,"-")', "-"],
    ["=XLOOKUP(25,C1:C3,B1:B3,,1)", "Iron ore"],
    ["=XLOOKUP(25,C1:C3,B1:B3,,-1)", "Copper"],
    ["=INDEX(C1:C3,2)", 20],
    ["=INDEX(B1:C3,3,2)", 30],
    ['=MATCH("Copper",B1:B3,0)', 2],
    ["=MATCH(25,C1:C3)", 2],
    ['=CONCAT(B1," ",A1)', "Iron 4"],
    ["=LEN(B3)", 8],
    ["=LEFT(B3,4)", "Iron"],
    ["=RIGHT(B3)", "e"],
    ["=UPPER(B1)", "IRON"],
    ["=LOWER(B1)", "iron"],
    ["=TODAY()", dateSerial(2026, 11, 4)],
    ["=NOW()", dateSerial(2026, 11, 4, 12, 0)],
    ["=SUM(C:C)", 60],
  ];
  for (const [formula, expected] of cases) it(formula, () => expect(calc(formula, cells)).toEqual(expected));

  it("treat dates as day numbers", () => {
    expect(calc("=A1+7", { A1: "2026-11-04" })).toBe(dateSerial(2026, 11, 11));
    expect(book({ A1: "2026-11-04", B1: "=A1+7", C1: "=B1-A1" }).hint("s1", 0, 1)).toBe("date");
    expect(book({ A1: "2026-11-04", B1: "=A1+7", C1: "=B1-A1" }).hint("s1", 0, 2)).toBeUndefined();
  });
});

describe("references across sheets", () => {
  it("read another sheet, by plain or quoted name, in any case", () => {
    const wb = book({ A1: "=Gear!B2*2", A2: "='Boss runs'!A1+1", A3: "=SUM('Boss runs'!A1:A2)", A4: "=gear!B2" }, [sheet("g", { B2: "21" }, "Gear"), sheet("b", { A1: "5", A2: "7" }, "Boss runs")]);
    expect(wb.value("s1", 0, 0)).toBe(42);
    expect(wb.value("s1", 1, 0)).toBe(6);
    expect(wb.value("s1", 2, 0)).toBe(12);
    expect(wb.value("s1", 3, 0)).toBe(21);
  });
});

describe("recalculation", () => {
  it("works out again only what depends on a change", () => {
    const sheets = [sheet("s1", { A1: "1", B1: "=A1*2", C1: "=B1+1", D1: "=5", E1: "=SUM(A1:A3)" })];
    const wb = new Workbook(sheets);
    expect(wb.value("s1", 0, 2)).toBe(3);
    expect(wb.value("s1", 0, 4)).toBe(1);
    wb.sync([sheet("s1", { ...sheets[0]!.cells, A1: "10" })]);
    expect(wb.value("s1", 0, 1)).toBe(20);
    expect(wb.value("s1", 0, 2)).toBe(21);
    expect(wb.value("s1", 0, 4)).toBe(10);
    wb.sync([sheet("s1", { A1: "10", A2: "5", B1: "=A1*2", C1: "=B1+1", D1: "=5", E1: "=SUM(A1:A3)" })]);
    expect(wb.value("s1", 0, 4)).toBe(15);
  });

  it("follows a cell that becomes a formula and back", () => {
    const wb = new Workbook([sheet("s1", { A1: "1", B1: "=A1" })]);
    expect(wb.value("s1", 0, 1)).toBe(1);
    wb.sync([sheet("s1", { A1: "=2+2", B1: "=A1" })]);
    expect(wb.value("s1", 0, 1)).toBe(4);
    wb.sync([sheet("s1", { B1: "=A1" })]);
    expect(wb.value("s1", 0, 1)).toBe(0);
  });

  it("shows #CYCLE! on a loop without hanging, names its cells, and recovers once it is broken", () => {
    const wb = new Workbook([sheet("s1", { A1: "=B1+1", B1: "=A1", C1: "=A1*2", D1: "=D1" })]);
    expect(wb.value("s1", 0, 0)).toEqual(err("#CYCLE!"));
    expect(wb.value("s1", 0, 1)).toEqual(err("#CYCLE!"));
    expect(wb.value("s1", 0, 2)).toEqual(err("#CYCLE!"));
    expect(wb.value("s1", 0, 3)).toEqual(err("#CYCLE!"));
    expect(wb.loop("s1", 0, 0)?.map((cell) => cell.col)).toEqual([0, 1]);
    expect(wb.loop("s1", 0, 1)?.map((cell) => cell.col)).toEqual([1, 0]);
    expect(wb.loop("s1", 0, 2)).toBeUndefined();
    wb.sync([sheet("s1", { A1: "=B1+1", B1: "5", C1: "=A1*2", D1: "=D1" })]);
    expect(wb.value("s1", 0, 0)).toBe(6);
    expect(wb.value("s1", 0, 2)).toBe(12);
    expect(wb.loop("s1", 0, 0)).toBeUndefined();
  });

  it("keeps IFERROR from hiding a loop", () => {
    const wb = new Workbook([sheet("s1", { A1: "=IFERROR(B1,0)", B1: "=A1" })]);
    expect(wb.value("s1", 0, 0)).toEqual(err("#CYCLE!"));
  });

  it("opens 10,000 rows and recalculates one change within a frame", () => {
    const cells: Record<string, string> = {};
    for (let row = 1; row <= 10_000; row++) {
      cells[`A${row}`] = `Item ${row}`;
      cells[`B${row}`] = String(row);
      cells[`C${row}`] = `=B${row}*2`;
      cells[`D${row}`] = row > 1 ? `=D${row - 1}+C${row}` : `=C${row}`;
    }
    cells.F1 = "=SUM(B:B)";
    cells.F2 = '=COUNTIF(A:A,"Item 1*")';
    // Each step is timed a few times and the fastest counts: that is the code's cost, not how busy the PC is while
    // the other test files run.
    const fastest = (runs: number, step: () => void) => {
      let best = Infinity;
      for (let run = 0; run < runs; run++) {
        const started = performance.now();
        step();
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    let wb = new Workbook();
    const opened = fastest(3, () => {
      wb = new Workbook([sheet("s1", cells)]);
      // What a screen shows: the first rows and the totals.
      for (let row = 0; row < 40; row++) for (let col = 0; col < 6; col++) wb.value("s1", row, col);
    });
    expect(wb.value("s1", 0, 5)).toBe(50_005_000);
    expect(opened).toBeLessThan(300);
    // The running total all the way down, then one change at the bottom, back and forth.
    expect(wb.value("s1", 9_999, 3)).toBe(100_010_000);
    const next = { ...cells, B10000: "0" };
    let flip = false;
    const changed = fastest(5, () => {
      flip = !flip;
      wb.sync([sheet("s1", flip ? next : cells)], new Map([["s1", ["B10000"]]]));
      wb.value("s1", 9_999, 3);
      wb.value("s1", 0, 5);
    });
    expect(changed).toBeLessThan(16);
    wb.sync([sheet("s1", next)], new Map([["s1", ["B10000"]]]));
    expect(wb.value("s1", 9_999, 3)).toBe(99_990_000);
    expect(wb.value("s1", 0, 5)).toBe(49_995_000);
    // Without saying what changed, the sheet is compared cell by cell: still quick.
    const started = performance.now();
    wb.sync([sheet("s1", { ...next, B9999: "1" })]);
    expect(wb.value("s1", 9_999, 3)).toBe(99_970_004);
    expect(performance.now() - started).toBeLessThan(150);
  });
});

describe("rewriting references", () => {
  const place = { sheet: "Sheet1" };

  it("moves references below inserted rows, absolute ones too", () => {
    expect(shiftReferences("=A1+A5+$A$5", place, "Sheet1", "row", 2, 3)).toBe("=A1+A8+$A$8");
    expect(shiftReferences("=SUM(A1:A5)", place, "Sheet1", "row", 2, 1)).toBe("=SUM(A1:A6)");
    expect(shiftReferences("=SUM(A3:A5)", place, "Sheet1", "row", 0, 1)).toBe("=SUM(A4:A6)");
    expect(shiftReferences("=SUM(C:C)", place, "Sheet1", "row", 0, 1)).toBe("=SUM(C:C)");
  });

  it("turns deleted cells into #REF! and shrinks ranges", () => {
    expect(shiftReferences("=A3*2", place, "Sheet1", "row", 2, -1)).toBe("=#REF!*2");
    expect(shiftReferences("=A5", place, "Sheet1", "row", 2, -2)).toBe("=A3");
    expect(shiftReferences("=SUM(A1:A5)", place, "Sheet1", "row", 1, -2)).toBe("=SUM(A1:A3)");
    expect(shiftReferences("=SUM(A2:A3)", place, "Sheet1", "row", 1, -2)).toBe("=SUM(#REF!)");
    expect(shiftReferences("=SUM(A3:A6)", place, "Sheet1", "row", 1, -3)).toBe("=SUM(A2:A3)");
  });

  it("handles columns and only the sheet it is about", () => {
    expect(shiftReferences("=B1+Gear!B1", place, "Sheet1", "col", 1, 1)).toBe("=C1+Gear!B1");
    expect(shiftReferences("=B1+Gear!B1", place, "Gear", "col", 0, 1)).toBe("=B1+Gear!C1");
    expect(shiftReferences("=B1+gear!B1", { sheet: "Gear" }, "Gear", "col", 0, -1)).toBe("=A1+gear!A1");
    expect(shiftReferences('="B1"&B1', place, "Sheet1", "col", 0, 1)).toBe('="B1"&C1');
  });

  it("follows a renamed sheet, quoting names with spaces and quotes", () => {
    expect(renameSheetReferences("=Gear!D7+gear!A1:B2", "Gear", "Boss runs")).toBe("='Boss runs'!D7+'Boss runs'!A1:B2");
    expect(renameSheetReferences("='Boss runs'!B2", "Boss runs", "Nik's runs")).toBe("='Nik''s runs'!B2");
    expect(renameSheetReferences("='Nik''s runs'!B2", "Nik's runs", "Runs")).toBe("=Runs!B2");
  });

  it("breaks references to a deleted sheet", () => {
    expect(dropSheetReferences("=Gear!D7+A1", "Gear")).toBe("=#REF!+A1");
  });

  it("moves relative parts when a formula is copied", () => {
    expect(moveFormula("=A1+$B$1+$C1+D$1", 2, 1)).toBe("=B3+$B$1+$C3+E$1");
    expect(moveFormula("=SUM(A1:A3)", 1, 0)).toBe("=SUM(A2:A4)");
    expect(moveFormula("=A1", -1, 0)).toBe("=#REF!");
    expect(moveFormula("=Gear!A1", 0, 2)).toBe("=Gear!C1");
  });
});

describe("German formulas", () => {
  it("store the English form", () => {
    expect(formulaToStored("=ROUND(A1;2)", "de")).toBe("=ROUND(A1,2)");
    expect(formulaToStored("=A1*1,5", "de")).toBe("=A1*1.5");
    expect(formulaToStored('=IF(A1>1,5;"a;b";"c,d")', "de")).toBe('=IF(A1>1.5,"a;b","c,d")');
    expect(formulaToStored("='Boss; runs'!A1", "de")).toBe("='Boss; runs'!A1");
  });

  it("keep a pasted English formula", () => {
    expect(looksEnglish("=ROUND(A1,2)")).toBe(true);
    expect(formulaToStored("=ROUND(A1,2)", "de")).toBe("=ROUND(A1,2)");
    expect(formulaToStored("=A1*1.5", "de")).toBe("=A1*1.5");
  });

  it("show the German form", () => {
    expect(formulaToShown("=ROUND(A1*1.5,2)", "de")).toBe("=ROUND(A1*1,5;2)");
    expect(formulaToShown('=CONCAT("1.5",",")', "de")).toBe('=CONCAT("1.5";",")');
    expect(formulaToShown("=ROUND(A1,2)", "en")).toBe("=ROUND(A1,2)");
  });

  it("go back and forth without change", () => {
    for (const stored of ["=SUM(A1:B2,3.25)", '=IF(Gear!A1="x",1,0)', "=XLOOKUP(2.5,A:A,B:B,,1)"]) {
      expect(formulaToStored(formulaToShown(stored, "de"), "de")).toBe(stored);
    }
  });
});
