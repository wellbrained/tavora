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

  it("splits a two-part root such as AppData/LocalLow from the folders below it", () => {
    const view = folderView("AppData/LocalLow/SadSocket/9Kings|json|");
    expect(view?.root).toBe("AppData/LocalLow");
    expect(view?.names).toEqual(["SadSocket", "9Kings"]);
    expect(folderView("Saved Games/Game/Saves|sav|")?.names).toEqual(["Game", "Saves"]);
    // A root this Tavora doesn't know still shows, as its manifest path.
    expect(folderView("AppData/Roaming/Discord|json|")).toMatchObject({ path: "AppData/Roaming/Discord", root: "", names: [] });
  });

  it("shows no read types when only key files are asked for", () => {
    const view = folderView("Documents/Game|pem,ppk|log");
    expect(view?.read).toEqual([]);
    expect(view?.nameOnly).toEqual(["log", "pem", "ppk"]);
  });
});
