import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every window and view Tavora makes is sandboxed and cut off from Node. This reads the source, so a new window made
// without these settings fails here, whatever it shows.

const MAIN = import.meta.dirname;

/** The source without its comments (strings are kept). */
function withoutComments(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"' || char === "'" || char === "`") {
      let end = index + 1;
      while (end < text.length && text[end] !== char) end += text[end] === "\\" ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end;
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      out += "\n";
    } else if (char === "/" && text[index + 1] === "*") {
      index = text.indexOf("*/", index + 2) + 1;
    } else out += char;
  }
  return out;
}

/** The text inside the brackets that open at `start`, strings skipped. */
function balanced(text: string, start: number): string {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"' || char === "'" || char === "`") {
      index++;
      while (index < text.length && text[index] !== char) index += text[index] === "\\" ? 2 : 1;
    } else if (char === "(" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === "}" || char === "]") {
      if (--depth === 0) return text.slice(start + 1, index);
    }
  }
  throw new Error("brackets do not close");
}

/** An object's entries, split at its own commas. */
function entries(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (char === '"' || char === "'" || char === "`") {
      index++;
      while (index < body.length && body[index] !== char) index += body[index] === "\\" ? 2 : 1;
    } else if ("({[".includes(char)) depth++;
    else if (")}]".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(from, index));
      from = index + 1;
    }
  }
  parts.push(body.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** An object written in the file, or the name of one, as its settings (a later one wins over an earlier, a spread is followed). */
function settings(expression: string, text: string, seen: string[] = [], lenient = false): Map<string, string> {
  const result = new Map<string, string>();
  const trimmed = expression.trim().replace(/\s+as const$/, "");
  if (trimmed.startsWith("{")) {
    for (const entry of entries(balanced(trimmed, 0))) {
      const spread = /^\.\.\.\s*(.+)$/.exec(entry);
      if (spread) {
        // Only the window's own options may spread something that is not a name (its saved bounds); the web settings may not.
        if (lenient && !/^\w+$/.test(spread[1]!)) continue;
        for (const [key, value] of settings(spread[1]!, text, seen, lenient)) result.set(key, value);
        continue;
      }
      const pair = /^(\w+)\s*(?::([\s\S]*))?$/.exec(entry);
      if (!pair) throw new Error(`cannot read ${entry}`);
      result.set(pair[1]!, (pair[2] ?? pair[1]!).trim());
    }
    return result;
  }
  if (/^\w+$/.test(trimmed) && !seen.includes(trimmed)) {
    const declaration = new RegExp(`(?:const|let)\\s+${trimmed}\\s*(?::[^=]+)?=\\s*\\{`).exec(text);
    if (!declaration) throw new Error(`no ${trimmed} in this file`);
    const open = declaration.index + declaration[0].length - 1;
    return settings(`{${balanced(text, open)}}`, text, [...seen, trimmed]);
  }
  throw new Error(`cannot resolve ${expression}`);
}

interface Site {
  file: string;
  kind: string;
  options: string;
  text: string;
}

function sites(): Site[] {
  const found: Site[] = [];
  const names = readdirSync(MAIN, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test(-helper)?\.ts$|\.fixture\.ts$|\.d\.ts$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
  for (const name of names) {
    const text = withoutComments(readFileSync(name, "utf8"));
    for (const match of text.matchAll(/new\s+(?:\w+\.)?(BrowserWindow|WebContentsView|BaseWindow|BrowserView)\s*\(/g)) {
      found.push({ file: path.relative(MAIN, name).replaceAll("\\", "/"), kind: match[1]!, options: balanced(text, match.index + match[0].length - 1), text });
    }
  }
  return found;
}

const all = sites();

/** Where each kind of window or view is made, and how often. A new place has to be added here, and its settings pass below. */
const EXPECTED = [
  "WebContentsView browser-view.ts:1",
  "BrowserWindow game-overlay-window.ts:1",
  "WebContentsView game-overlay-window.ts:1",
  "BrowserWindow game-veil-window.ts:1",
  "BrowserWindow host.ts:1",
  "WebContentsView module-view.ts:1",
  "WebContentsView overlay-canvas.ts:2",
  "BrowserWindow overlay-preview-window.ts:1",
  "WebContentsView overlay-preview-window.ts:2",
  "BrowserWindow page-import.ts:1",
  "WebContentsView panel-cover.ts:1",
  "WebContentsView toast-view.ts:1",
  "BrowserWindow tooltip-window.ts:1",
].sort();

describe("windows and views made by the main process", () => {
  it("are made in the places this test knows", () => {
    const counts = new Map<string, number>();
    for (const site of all) counts.set(`${site.kind} ${site.file}`, (counts.get(`${site.kind} ${site.file}`) ?? 0) + 1);
    expect([...counts].map(([key, count]) => `${key}:${count}`).sort()).toEqual(EXPECTED);
  });

  it("never use BrowserView or a base window without a page", () => {
    expect(all.filter((site) => site.kind === "BrowserView" || site.kind === "BaseWindow")).toEqual([]);
  });

  it("read the settings of a window that shares them through a name and a spread", () => {
    const site = all.find((one) => one.file === "overlay-preview-window.ts" && one.kind === "WebContentsView")!;
    const prefs = settings(settings(site.options, site.text, [], true).get("webPreferences")!, site.text);
    expect(prefs.get("sandbox")).toBe("true");
    expect(prefs.has("session")).toBe(true);
  });

  for (const site of all) {
    it(`${site.kind} in ${site.file} is sandboxed, isolated and has no Node`, () => {
      const own = settings(site.options, site.text, [], true);
      expect(own.has("webPreferences"), "has webPreferences").toBe(true);
      const prefs = settings(own.get("webPreferences")!, site.text);
      expect(prefs.get("sandbox")).toBe("true");
      expect(prefs.get("contextIsolation")).toBe("true");
      expect(prefs.get("nodeIntegration")).toBe("false");
      expect(prefs.get("webviewTag")).not.toBe("true");
      for (const flag of ["nodeIntegrationInSubFrames", "nodeIntegrationInWorker", "allowRunningInsecureContent", "experimentalFeatures", "nativeWindowOpen"]) {
        expect(prefs.get(flag), flag).not.toBe("true");
      }
      expect(prefs.get("webSecurity")).not.toBe("false");
    });
  }

  it("are never switched to an unsafe value anywhere in a file that makes one", () => {
    for (const site of new Map(all.map((one) => [one.file, one])).values()) {
      expect(site.text, site.file).not.toMatch(/sandbox:\s*false|contextIsolation:\s*false|nodeIntegration:\s*true|webviewTag:\s*true|webSecurity:\s*false/);
    }
  });

  it("have no webview tag in the host's source", () => {
    expect(withoutComments(readFileSync(path.join(MAIN, "host.ts"), "utf8"))).not.toMatch(/<webview/i);
  });

  it("start from an app that sandboxes every renderer", () => {
    expect(withoutComments(readFileSync(path.join(MAIN, "index.ts"), "utf8"))).toMatch(/^app\.enableSandbox\(\);$/m);
  });
});
