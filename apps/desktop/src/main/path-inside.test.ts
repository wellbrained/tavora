import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInside, isInsideOrSame, pathChecks } from "./path-inside";

/** inner, outer, and the answers of isInsideOrSame and isInside. */
type Row = [name: string, inner: string, outer: string, orSame: boolean, strict: boolean];

const WINDOWS: Row[] = [
  ["the same path", "C:\\a\\b", "C:\\a\\b", true, false],
  ["a child", "C:\\a\\b\\c", "C:\\a\\b", true, true],
  ["a parent", "C:\\a", "C:\\a\\b", false, false],
  ["a trailing separator on the inner one", "C:\\a\\b\\", "C:\\a\\b", true, false],
  ["a trailing separator on the outer one", "C:\\a\\b\\c", "C:\\a\\b\\", true, true],
  ["forward slashes", "C:/a/b/c", "C:\\a\\b", true, true],
  ["doubled separators", "C:\\a\\\\b\\\\c", "C:\\a\\b", true, true],
  ["a sibling that starts with the same name", "C:\\ab", "C:\\a", false, false],
  ["a sibling's child", "C:\\ab\\c", "C:\\a", false, false],
  ["a `..` that stays inside", "C:\\a\\b\\..\\c", "C:\\a", true, true],
  ["a `..` that climbs out", "C:\\a\\..\\b", "C:\\a", false, false],
  ["a `..` that climbs out and back into the same name", "C:\\a\\..\\a\\x", "C:\\a", true, true],
  ["a `..` that ends at the outer one's parent", "C:\\a\\b\\..\\..", "C:\\a", false, false],
  ["a folder named like `..x`", "C:\\a\\..x", "C:\\a", true, true],
  ["a folder named `...`", "C:\\a\\...", "C:\\a", true, true],
  ["a different case", "c:\\A\\B\\file", "C:\\a\\b", true, true],
  ["the same path in another case", "C:\\A\\B", "c:\\a\\b", true, false],
  ["another drive with the same path", "D:\\a\\b", "C:\\a\\b", false, false],
  ["another drive's root", "D:\\", "C:\\", false, false],
  ["a drive root holding a folder", "C:\\a", "C:\\", true, true],
  ["a drive root and itself", "C:\\", "C:\\", true, false],
  ["a UNC child", "\\\\srv\\share\\a", "\\\\srv\\share", true, true],
  ["a UNC share and itself", "\\\\srv\\share", "\\\\srv\\share", true, false],
  ["a UNC sibling share with a longer name", "\\\\srv\\share2\\a", "\\\\srv\\share", false, false],
  ["another server's share", "\\\\other\\share\\a", "\\\\srv\\share", false, false],
  ["a UNC path and a drive", "\\\\srv\\share\\a", "C:\\a", false, false],
  ["a UNC path in another case", "\\\\SRV\\Share\\a", "\\\\srv\\share", true, true],
];

const POSIX: Row[] = [
  ["the same path", "/a/b", "/a/b", true, false],
  ["a child", "/a/b/c", "/a/b", true, true],
  ["a parent", "/a", "/a/b", false, false],
  ["a trailing separator on the inner one", "/a/b/", "/a/b", true, false],
  ["a trailing separator on the outer one", "/a/b/c", "/a/b/", true, true],
  ["doubled separators", "/a//b//c", "/a/b", true, true],
  ["a sibling that starts with the same name", "/ab", "/a", false, false],
  ["a sibling's child", "/ab/c", "/a", false, false],
  ["a `..` that stays inside", "/a/b/../c", "/a", true, true],
  ["a `..` that climbs out", "/a/../b", "/a", false, false],
  ["a `..` that climbs out and back into the same name", "/a/../a/x", "/a", true, true],
  ["a folder named like `..x`", "/a/..x", "/a", true, true],
  ["a different case is another folder", "/A/b", "/a", false, false],
  ["the root holds everything", "/a", "/", true, true],
  ["the root and itself", "/", "/", true, false],
  ["a backslash is part of a name, not a separator", "/a\\b", "/a", false, false],
  ["a backslash never works as `..`", "/a\\..\\b", "/a", false, false],
];

function table(name: string, api: typeof path.win32, rows: Row[]) {
  const checks = pathChecks(api);
  describe(name, () => {
    it.each(rows)("%s", (_name, inner, outer, orSame, strict) => {
      expect(checks.isInsideOrSame(inner, outer)).toBe(orSame);
      expect(checks.isInside(inner, outer)).toBe(strict);
    });
  });
}

describe("path containment", () => {
  table("with Windows paths", path.win32, WINDOWS);
  table("with POSIX paths", path.posix, POSIX);

  it("settles a relative path from the current folder, as path.resolve does", () => {
    const here = process.cwd();
    expect(isInsideOrSame(".", here)).toBe(true);
    expect(isInside(".", here)).toBe(false);
    expect(isInside("a/b", here)).toBe(true);
    expect(isInside("..", here)).toBe(false);
    expect(isInsideOrSame(here, "a")).toBe(false);
  });

  it("is the default platform's flavour", () => {
    const own = process.platform === "win32" ? WINDOWS : POSIX;
    for (const [, inner, outer, orSame, strict] of own) {
      expect(isInsideOrSame(inner, outer)).toBe(orSame);
      expect(isInside(inner, outer)).toBe(strict);
    }
  });
});
