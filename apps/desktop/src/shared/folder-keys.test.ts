import { describe, expect, it } from "vitest";
import { folderView } from "./folder-keys";

describe("folderView", () => {
  it("lists readable types and names-only types", () => {
    const view = folderView("Documents/Game|sav,txt|log");
    expect(view?.read).toEqual(["sav", "txt"]);
    expect(view?.nameOnly).toEqual(["log"]);
  });

  it("leaves key files out of what a module reads", () => {
    const view = folderView("Documents/Game|sav,pem,key,p12,pfx,ppk|");
    expect(view?.read).toEqual(["sav"]);
  });

  it("shows no read types when only key files are asked for", () => {
    expect(folderView("Documents/Game|pem,ppk|log")?.read).toEqual([]);
  });
});
