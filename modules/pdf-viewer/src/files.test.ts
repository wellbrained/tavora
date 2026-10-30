import { describe, expect, it } from "vitest";
import { ACCEPT_ATTRIBUTE, addFile, cleanName, detectType, formatBytes, NAME_LIMIT, parseFiles, removeFile, renameFile, setFileView, sortPicked, type FileEntry, type FilesData } from "./files";

const entry = (id: string, patch: Partial<FileEntry> = {}): FileEntry => ({
  id,
  name: `${id}.pdf`,
  type: "application/pdf",
  kind: "pdf",
  addedAt: "2026-10-30T10:00:00.000Z",
  view: { page: 1, zoom: 1, fit: "width" },
  ...patch,
});

describe("detectType", () => {
  it("trusts a type we store", () => {
    expect(detectType({ name: "a.bin", type: "application/pdf" })).toBe("application/pdf");
    expect(detectType({ name: "a", type: "image/webp" })).toBe("image/webp");
  });

  it("falls back to the extension when there is no type or a generic one", () => {
    expect(detectType({ name: "Guide.PDF", type: "" })).toBe("application/pdf");
    expect(detectType({ name: "map.jpeg", type: "application/octet-stream" })).toBe("image/jpeg");
    expect(detectType({ name: "map.png", type: "" })).toBe("image/png");
  });

  it("refuses everything else, also a wrong extension on a known other type", () => {
    expect(detectType({ name: "x.svg", type: "image/svg+xml" })).toBeNull();
    expect(detectType({ name: "x.pdf", type: "text/plain" })).toBeNull();
    expect(detectType({ name: "notes", type: "" })).toBeNull();
    expect(detectType({ name: "a.bmp", type: "" })).toBeNull();
  });

  it("takes image/jpg as JPEG", () => {
    expect(detectType({ name: "a.jpg", type: "image/jpg" })).toBe("image/jpeg");
  });
});

describe("sortPicked", () => {
  it("separates what can be shown from what cannot, keeping the order", () => {
    const result = sortPicked([
      { name: "a.pdf", type: "application/pdf" },
      { name: "b.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { name: "c.png", type: "" },
    ]);
    expect(result).toEqual({ accepted: [0, 2], refused: ["b.docx"] });
  });

  it("lets the picker offer PDFs and the four pictures", () => {
    for (const type of ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]) expect(ACCEPT_ATTRIBUTE).toContain(type);
  });
});

describe("the file list", () => {
  it("adds a file once", () => {
    const data: FilesData = { files: [] };
    addFile(data, entry("a"));
    addFile(data, entry("a", { name: "other" }));
    expect(data.files.map((file) => file.name)).toEqual(["a.pdf"]);
  });

  it("renames, trimming and cutting the name, and ignores an empty one", () => {
    const data: FilesData = { files: [entry("a")] };
    renameFile(data, "a", "  Walkthrough  ");
    expect(data.files[0]!.name).toBe("Walkthrough");
    renameFile(data, "a", "   ");
    expect(data.files[0]!.name).toBe("Walkthrough");
    renameFile(data, "a", "x".repeat(500));
    expect(data.files[0]!.name).toHaveLength(NAME_LIMIT);
    renameFile(data, "missing", "Nope");
    expect(cleanName(" a ")).toBe("a");
  });

  it("removes a file and survives running twice", () => {
    const data: FilesData = { files: [entry("a"), entry("b")] };
    removeFile(data, "a");
    removeFile(data, "a");
    expect(data.files.map((file) => file.id)).toEqual(["b"]);
  });
});

describe("remembering page and zoom", () => {
  it("keeps what is not given and limits what is", () => {
    const data: FilesData = { files: [entry("a")] };
    setFileView(data, "a", { page: 12 });
    expect(data.files[0]!.view).toEqual({ page: 12, zoom: 1, fit: "width" });
    setFileView(data, "a", { zoom: 9, fit: null });
    expect(data.files[0]!.view).toEqual({ page: 12, zoom: 5, fit: null });
    setFileView(data, "a", { page: -3, zoom: 0.01 });
    expect(data.files[0]!.view).toMatchObject({ page: 1, zoom: 0.25 });
    setFileView(data, "missing", { page: 2 });
  });
});

describe("parseFiles", () => {
  it("keeps good entries, drops broken, repeated or unknown ones and fills in the view", () => {
    const data = parseFiles({
      files: [
        { id: "a", name: "A", type: "application/pdf", addedAt: "2026-10-30T10:00:00.000Z", view: { page: 4, zoom: 1.5, fit: null } },
        { id: "a", name: "again", type: "application/pdf" },
        { id: "b", type: "image/png" },
        { id: "c", name: "C", type: "text/html" },
        { name: "no id", type: "image/png" },
        7,
      ],
    });
    expect(data.files.map((file) => file.id)).toEqual(["a", "b"]);
    expect(data.files[0]).toMatchObject({ kind: "pdf", view: { page: 4, zoom: 1.5, fit: null } });
    expect(data.files[1]).toMatchObject({ name: "b", kind: "image", view: { page: 1, zoom: 1, fit: "page" } });
  });

  it("makes an empty list of anything else", () => {
    for (const raw of [null, 3, "x", [], {}, { files: "no" }]) expect(parseFiles(raw)).toEqual({ files: [] });
  });
});

describe("formatBytes", () => {
  it("writes short sizes", () => {
    expect([formatBytes(500), formatBytes(2048), formatBytes(1.5 * 1024 * 1024), formatBytes(50 * 1024 * 1024)]).toEqual(["500 B", "2 KB", "1.5 MB", "50 MB"]);
  });
});
