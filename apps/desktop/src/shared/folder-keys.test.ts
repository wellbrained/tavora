import { describe, expect, it } from "vitest";
import { folderView } from "./folder-keys";

describe("folderView", () => {
  it("lists readable types and names-only types", () => {
    const view = folderView("Documents/Game|sav,txt|log");
    expect(view?.read).toEqual(["sav", "txt"]);
    expect(view?.nameOnly).toEqual(["log"]);
  });

  it("shows key files asked for in read as names only", () => {
    const view = folderView("Documents/Game|sav,pem,key,p12,pfx,ppk|");
    expect(view?.read).toEqual(["sav"]);
    expect(view?.nameOnly).toEqual(["pem", "key", "p12", "pfx", "ppk"]);
  });

  it("shows no read types when only key files are asked for", () => {
    const view = folderView("Documents/Game|pem,ppk|log");
    expect(view?.read).toEqual([]);
    expect(view?.nameOnly).toEqual(["log", "pem", "ppk"]);
  });
});
