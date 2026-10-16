import { describe, expect, it } from "vitest";
import type { BlobInfo } from "@tavora/sdk";
import { dataUrlToBlob, isStorable, pictureFileIds, UNUSED_AFTER_MS, unusedFiles } from "./pictures";
import { parseBoard } from "./boards";

describe("dataUrlToBlob", () => {
  it("turns a base64 data address into a picture with the right type and bytes", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(blob?.type).toBe("image/png");
    expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("refuses anything that is not a base64 data address", () => {
    for (const text of ["", "https://example.com/a.png", "data:image/png,hello", "data:;base64,AAAA", "javascript:alert(1)"]) expect(dataUrlToBlob(text)).toBeNull();
  });
});

describe("isStorable", () => {
  it("takes the four kinds the file store takes, and nothing else", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) expect(isStorable(type)).toBe(true);
    for (const type of ["image/svg+xml", "image/bmp", "application/octet-stream", ""]) expect(isStorable(type)).toBe(false);
  });
});

describe("pictureFileIds", () => {
  it("lists the files of the pictures that are on the board, once each", () => {
    const elements = [
      { type: "image", fileId: "a" },
      { type: "rectangle" },
      { type: "image", fileId: "b", isDeleted: true },
      { type: "image", fileId: "a" },
      { type: "image", fileId: null },
      { type: "image", fileId: "c", isDeleted: false },
    ];
    expect(pictureFileIds(elements)).toEqual(["a", "c"]);
  });
});

describe("unusedFiles", () => {
  const blob = (id: string, ageMs: number): BlobInfo => ({ id: id.repeat(32), bytes: 1, type: "image/png", createdAt: new Date(1_000_000_000_000 - ageMs).toISOString() });
  const now = 1_000_000_000_000;

  it("finds old files that no board uses, and keeps new ones so a picture being added is safe", () => {
    const files = [blob("a", UNUSED_AFTER_MS + 1000), blob("b", UNUSED_AFTER_MS + 1000), blob("c", 60_000)];
    expect(unusedFiles(files, new Set(["b".repeat(32)]), now).map((file) => file.id[0])).toEqual(["a"]);
  });
});

describe("a board's stored files", () => {
  const blobId = "a".repeat(32);
  it("keeps well-formed entries and drops the rest", () => {
    const board = parseBoard({
      files: {
        good: { blobId, mimeType: "image/webp", created: 5 },
        noId: { blobId: "x", mimeType: "image/png", created: 5 },
        noType: { blobId, mimeType: 4, created: 5 },
        noTime: { blobId, mimeType: "image/png", created: "now" },
        list: [1],
      },
    });
    expect(Object.keys(board.files)).toEqual(["good"]);
    expect(parseBoard({ files: "x" }).files).toEqual({});
  });
});
