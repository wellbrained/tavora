import { readFileSync } from "node:fs";
import path from "node:path";
import { METHOD_INFO, type CallName } from "@tavora/sdk/protocol";
import { describe, expect, it } from "vitest";

// The SDK's METHOD_INFO says which calls need a click (the memory host, `needsGesture` and the protocol reference read
// it); the host's own checks are here. This keeps the two from drifting apart: a check without a table entry, or an
// entry the host doesn't check, fails. Which params need the click is the SDK's test (protocol.test.ts).
const source = (file: string) => readFileSync(path.join(import.meta.dirname, file), "utf8").replace(/\r\n/g, "\n");

/** The calls the bridge side checks: `takeGesture("…")` in module-view.ts, `gesture("…")` in connection.ts. */
function bridgeChecks(): string[] {
  const names = [...source("module-view.ts").matchAll(/\btakeGesture\(\s*["'`]([^"'`]+)["'`]/g), ...source("connection.ts").matchAll(/\bawait gesture\(\s*["'`]([^"'`]+)["'`]/g)];
  return names.map((match) => match[1]!);
}

/** The call each address the module's session answers stands for. A new address must be added here. */
const PATH_CALLS: Record<string, CallName> = {
  READ_ONLY_FILE_PATH: "files.read",
  BLOB_PATH: "blobs.put",
  CLIPBOARD_PATH: "clipboard.writeImage",
  JSON_EXPORT_PATH: "files.exportJson",
  PICTURES_PATH: "pictures.save",
  JSON_SAVE_PATH: "files.saveJson",
  JSON_OPEN_PATH: "files.openJson",
};

/** The addresses the session answers, and whether each one takes a press (`pressCheck`) first. */
function sessionRoutes(): Map<string, boolean> {
  const text = source("module-view.ts");
  const routes = new Map<string, boolean>();
  const starts = [...text.matchAll(/if \(url\.pathname(?:\.startsWith\(| === )(\w+_PATH)\)?\)/g)];
  starts.forEach((match, index) => {
    const end = starts[index + 1]?.index ?? text.indexOf("\n    if (request.method", match.index);
    routes.set(match[1]!, text.slice(match.index, end).includes("pressCheck("));
  });
  return routes;
}

describe("the click checks", () => {
  const table = (Object.keys(METHOD_INFO) as CallName[]).filter((name) => METHOD_INFO[name].gesture !== false).sort();

  it("knows every address the module's session answers", () => {
    expect([...sessionRoutes().keys()].sort()).toEqual(Object.keys(PATH_CALLS).sort());
  });

  it("are the calls METHOD_INFO marks as needing a click, no more and no fewer", () => {
    const pressed = [...sessionRoutes()].filter(([, checked]) => checked).map(([route]) => PATH_CALLS[route]!);
    const host = [...new Set([...bridgeChecks(), ...pressed])].sort();
    expect(host).toEqual(table);
  });
});
