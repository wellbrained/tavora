import { describe, expect, it } from "vitest";
import { findUnsafeSwitch } from "./unsafe-switches";

const EXE = "C:\\Users\\user\\AppData\\Local\\Programs\\Tavora\\Tavora.exe";

describe("findUnsafeSwitch", () => {
  it("lets a plain start through", () => {
    expect(findUnsafeSwitch([EXE])).toBeUndefined();
    expect(findUnsafeSwitch([])).toBeUndefined();
  });

  it("lets the updater's arguments through, in any case", () => {
    expect(findUnsafeSwitch([EXE, "--updated", "--force-run"])).toBeUndefined();
    expect(findUnsafeSwitch([EXE, "--Updated"])).toBeUndefined();
  });

  it("finds a switch in every form Chromium accepts on Windows", () => {
    expect(findUnsafeSwitch([EXE, "--remote-debugging-port=9222"])).toBe("remote-debugging-port");
    expect(findUnsafeSwitch([EXE, "-no-sandbox"])).toBe("no-sandbox");
    expect(findUnsafeSwitch([EXE, "/inspect"])).toBe("inspect");
    expect(findUnsafeSwitch([EXE, "--Disable-Web-Security"])).toBe("disable-web-security");
  });

  // The switches a denylist missed (security audit run 5), and more of the kind: none of them is one Tavora takes.
  it.each([
    "--inspect-port=9229",
    "--inspect-brk-node",
    "--remote-debugging-address=0.0.0.0",
    "--js-flags=--allow-natives-syntax",
    "--ignore-certificate-errors-spki-list=abc",
    "--ignore-urlfetcher-cert-requests",
    "--host-resolver-rules=MAP * 127.0.0.1",
    "--proxy-bypass-list=*",
    "--proxy-auto-detect",
    "--load-extension=C:\\evil",
    "--disable-extensions-except=C:\\evil",
    "--disable-web-security",
    "--allow-file-access-from-files",
    "--enable-logging=file",
    "--log-file=C:\\Users\\Public\\tavora.log",
    "--user-data-dir=\\\\server\\share",
    "--disk-cache-dir=C:\\elsewhere",
    "--no-sandbox",
    "--disable-features=IsolateOrigins,site-per-process",
    "--enable-features=SomethingNew",
    "--disable_some_thing",
    "--updated-and-more",
    "--",
  ])("refuses %s", (arg) => {
    expect(findUnsafeSwitch([EXE, "--updated", arg])).toBe(/^-+([^=]*)/.exec(arg)![1]!.toLowerCase());
  });

  it("does not mistake an argument that is no switch for one", () => {
    expect(findUnsafeSwitch([EXE, "tavora://game/no-sandbox"])).toBeUndefined();
    expect(findUnsafeSwitch([EXE, "C:\\Games\\--no-sandbox"])).toBeUndefined();
  });

  it("keeps a very long name short", () => {
    expect(findUnsafeSwitch([EXE, `--${"x".repeat(500)}`])).toHaveLength(60);
  });
});
