// A newer copy may add fields (the catalogue's, before a fallback to the shipped one): this version keeps them through
// a read, an edit and the save, so nothing the newer one wrote is lost when it comes back.
import { expect, it } from "vitest";
import { parseFiles, renameFile, setFileView } from "./files";

it("keeps a newer version's fields on the list, its files and their views", () => {
  const data = parseFiles({
    sort: "name",
    files: [{ id: "f1", type: "application/pdf", name: "Guide", addedAt: "", tags: ["map"], view: { page: 2, zoom: 1, fit: "width", side: null, rotate: 90 }, link: { ref: "a".repeat(32), size: 1, modifiedAt: 2, path: "x" } }],
  });
  renameFile(data, "f1", "Map guide");
  setFileView(data, "f1", { page: 3 });
  expect(JSON.parse(JSON.stringify(data))).toMatchObject({ sort: "name", files: [{ name: "Map guide", tags: ["map"], view: { page: 3, rotate: 90 }, link: { path: "x" } }] });
});
