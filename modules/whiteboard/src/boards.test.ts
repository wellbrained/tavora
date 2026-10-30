import { describe, expect, it } from "vitest";
import { boardTitle, cleanName, formatMegabytes, isBoardId, MAX_BOARD_BYTES, MAX_NAME, newBoardId, uniqueName, parseBoard, sceneSignature, sizeLevel, sortBoards, WARN_BOARD_BYTES } from "./boards";

describe("parseBoard", () => {
  it("fills in a missing or damaged board", () => {
    expect(parseBoard(null, "T")).toEqual({ version: 1, elements: [], files: {}, name: "", background: "#ffffff", grid: false, createdAt: "T" });
    expect(parseBoard({ elements: "nope", background: 4, createdAt: 7 }, "T")).toEqual({ version: 1, elements: [], files: {}, name: "", background: "#ffffff", grid: false, createdAt: "T" });
    expect(parseBoard([1, 2] as never, "T").elements).toEqual([]);
  });

  it("keeps valid elements and drops anything that is not an object", () => {
    const rectangle = { id: "a", type: "rectangle" };
    expect(parseBoard({ elements: [rectangle, 4, null, "x", [1]], background: "#fff", createdAt: "C" })).toEqual({ version: 1, elements: [rectangle], files: {}, name: "", background: "#fff", grid: false, createdAt: "C" });
  });

  it("opens older boards without a grid and keeps an explicit grid choice", () => {
    expect(parseBoard({ elements: [] }).grid).toBe(false);
    expect(parseBoard({ grid: true }).grid).toBe(true);
    for (const grid of [false, "true", 1, null]) expect(parseBoard({ grid }).grid).toBe(false);
    expect(sceneSignature([], "#fff", true)).not.toBe(sceneSignature([], "#fff", false));
  });

  it("accepts only colours as a background", () => {
    expect(parseBoard({ background: "transparent" }, "T").background).toBe("transparent");
    expect(parseBoard({ background: "url(javascript:alert(1))" }, "T").background).toBe("#ffffff");
    expect(parseBoard({ background: "#12345g" }, "T").background).toBe("#ffffff");
  });
});

describe("board names and ids", () => {
  it("cleans a name to one trimmed line of a sensible length", () => {
    expect(cleanName("  Atlas \n map ")).toBe("Atlas map");
    expect(cleanName("   ")).toBe("");
    expect(cleanName("x".repeat(200))).toHaveLength(MAX_NAME);
  });

  it("makes ids the host accepts that sort in the order the boards were made", () => {
    const a = newBoardId(1_700_000_000_000, 0.1);
    const b = newBoardId(1_700_000_005_000, 0.9);
    const c = newBoardId(1_800_000_000_000, 0);
    for (const id of [a, b, c]) {
      expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
      expect(isBoardId(id)).toBe(true);
    }
    expect(sortBoards([{ id: c }, { id: a }, { id: b }]).map((board) => board.id)).toEqual([a, b, c]);
  });

  it("does not take other documents for boards", () => {
    for (const id of ["scratchpad", "board-", "board-xyz", "BOARD-000000000-0000"]) expect(isBoardId(id)).toBe(false);
  });

  it("numbers a new board after the existing ones, skipping names that are taken", () => {
    expect(uniqueName([], "Board", 1)).toBe("Board 1");
    expect(uniqueName(["Board 1"], "Board", 2)).toBe("Board 2");
    expect(uniqueName(["Atlas", "board 2"], "Board", 3)).toBe("Board 3");
  });

  it("gives a starter its plain name first, then numbers it", () => {
    expect(uniqueName(["Board 1"], "Idea board")).toBe("Idea board");
    expect(uniqueName(["idea board"], "Idea board")).toBe("Idea board 2");
    expect(uniqueName(["Idea board", "Idea board 2"], "Idea board")).toBe("Idea board 3");
  });

  it("keeps the starter board, which has no time in its id, first", () => {
    const later = newBoardId(1_700_000_005_000, 0.5);
    const earlier = newBoardId(1_700_000_000_000, 0.1);
    expect(sortBoards([{ id: later }, { id: "board-start" }, { id: earlier }]).map((board) => board.id)).toEqual(["board-start", earlier, later]);
  });

  it("reads a board's name as one clean line, and titles a nameless board", () => {
    expect(parseBoard({ name: "  Atlas \n map " }).name).toBe("Atlas map");
    expect(parseBoard({ name: 4 }).name).toBe("");
    expect(boardTitle(parseBoard({ name: "Atlas" }))).toBe("Atlas");
    expect(boardTitle(parseBoard(null))).toBe("Board");
  });
});

describe("size", () => {
  it("warns at 3 MB and refuses beyond the 4 MB a document holds", () => {
    expect(sizeLevel(1000)).toBe("ok");
    expect(sizeLevel(WARN_BOARD_BYTES)).toBe("ok");
    expect(sizeLevel(WARN_BOARD_BYTES + 1)).toBe("warn");
    expect(sizeLevel(MAX_BOARD_BYTES)).toBe("warn");
    expect(sizeLevel(MAX_BOARD_BYTES + 1)).toBe("full");
    expect(formatMegabytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("sceneSignature", () => {
  const element = (versionNonce: number, isDeleted = false) => ({ versionNonce, isDeleted });
  it("changes when anything is drawn, edited or deleted, and when the background changes", () => {
    const base = sceneSignature([element(1), element(2)], "#fff");
    expect(sceneSignature([element(1), element(2)], "#fff")).toBe(base);
    expect(sceneSignature([element(1), element(3)], "#fff")).not.toBe(base);
    expect(sceneSignature([element(1)], "#fff")).not.toBe(base);
    expect(sceneSignature([element(1), element(2, true)], "#fff")).not.toBe(base);
    expect(sceneSignature([element(1), element(2)], "#000")).not.toBe(base);
  });
});
