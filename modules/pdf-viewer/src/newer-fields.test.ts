// A newer copy may add fields (the catalogue's, before a fallback to the shipped one): this version keeps them through
// a read, an edit and the save, so nothing the newer one wrote is lost when it comes back.
import { expect, it } from "vitest";
import { createMemoryHost } from "@tavora/sdk/testing";
import { FILES_ID, parseFiles, renameFile, replaceCopy, setFileView, fitToSave, shownFit, shownSide } from "./files";
import { createFilesStore } from "./store";

it("keeps a newer version's fields on the list, its files and their views", () => {
  const data = parseFiles({
    sort: "name",
    files: [{ id: "f1", type: "application/pdf", name: "Guide", addedAt: "", tags: ["map"], view: { page: 2, zoom: 1, fit: "width", side: null, rotate: 90 }, link: { ref: "a".repeat(32), size: 1, modifiedAt: 2, path: "x" } }],
  });
  renameFile(data, "f1", "Map guide");
  setFileView(data, "f1", { page: 3 });
  expect(JSON.parse(JSON.stringify(data))).toMatchObject({ sort: "name", files: [{ name: "Map guide", tags: ["map"], view: { page: 3, rotate: 90 }, link: { path: "x" } }] });
});

it("keeps a file of a type a newer version takes, in its place, when the list is saved", async () => {
  const { sdk, host } = createMemoryHost();
  const svg = { id: "f2", type: "image/svg+xml", name: "Map", addedAt: "", view: { page: 1, zoom: 1, fit: "page", side: null } };
  const pdf = (id: string) => ({ id, type: "application/pdf", name: id, addedAt: "", view: { page: 1, zoom: 1, fit: "width", side: null } });
  await host.documents.put({ id: FILES_ID, title: "Files", data: { files: [pdf("f1"), svg, pdf("f3")] } });
  const store = await createFilesStore(sdk, { title: () => "Files", debounceMs: 0 });
  expect(store.files.value.map((file) => file.id)).toEqual(["f1", "f3"]);
  await store.rename("f1", "Guide");
  const saved = host.documents.get(FILES_ID)!.data as { files: { id: string }[] };
  expect(saved.files.map((file) => file.id)).toEqual(["f1", "f2", "f3"]);
  expect(saved.files[1]).toEqual(svg);
  await store.dispose();
});

it("keeps a newer version's fields on the link when the original is reloaded", () => {
  const ref = "a".repeat(32);
  const data = parseFiles({ files: [{ id: "f1", type: "application/pdf", name: "Guide", link: { ref, size: 1, modifiedAt: 1, skipped: "2:2", path: "x" } }] });
  replaceCopy(data, "f1", { id: "f2", type: "application/pdf" }, { ref, size: 2, modifiedAt: 2 });
  expect(data.files[0]!.link).toEqual({ ref, size: 2, modifiedAt: 2, path: "x" });
});

it("keeps a fit and a side a newer version added when the view is saved, and shows the defaults", () => {
  const data = parseFiles({ files: [{ id: "f1", type: "application/pdf", name: "Guide", view: { page: 2, zoom: 1, fit: "height", side: "notes" } }] });
  setFileView(data, "f1", { page: 3 });
  expect(data.files[0]!.view).toMatchObject({ page: 3, fit: "height", side: "notes" });
  expect([shownFit(data.files[0]!.view.fit, "pdf"), shownSide(data.files[0]!.view.side)]).toEqual(["width", null]);
});

it("saves a fit the reader picks, also the default, but keeps a newer one through a refit", () => {
  expect(fitToSave("width", "height", "pdf", false)).toBe("height");
  expect(fitToSave("width", "height", "pdf", true)).toBe("width");
  expect(fitToSave("page", "height", "pdf", false)).toBe("page");
  expect(fitToSave(null, "height", "pdf", false)).toBeNull();
});
