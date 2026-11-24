import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clearUnsafeEnvironment, findUnsafeSwitch } from "./unsafe-switches";

const EXE = "C:\\Users\\user\\AppData\\Local\\Programs\\Tavora\\Tavora.exe";

describe("findUnsafeSwitch", () => {
  it("lets a plain start through", () => {
    expect(findUnsafeSwitch([EXE])).toBeUndefined();
    expect(findUnsafeSwitch([])).toBeUndefined();
  });

  it("lets the updater's argument through, in any case, but not with a value", () => {
    expect(findUnsafeSwitch([EXE, "--updated"])).toBeUndefined();
    expect(findUnsafeSwitch([EXE, "--Updated"])).toBeUndefined();
    expect(findUnsafeSwitch([EXE, "--updated=yes"])).toBe("updated");
    // The installer never passes it to the app (NSIS StartApp passes only --updated).
    expect(findUnsafeSwitch([EXE, "--force-run"])).toBe("force-run");
  });

  it("lets the GPU troubleshooting switches through, a scale factor only as a plain number", () => {
    expect(findUnsafeSwitch([EXE, "--disable-gpu", "--disable-gpu-compositing", "--force-device-scale-factor=1.25"])).toBeUndefined();
    expect(findUnsafeSwitch([EXE, "--force-device-scale-factor=2"])).toBeUndefined();
    for (const value of ["", "0", "1,5", "1.5x", "-1", "1e3", "100", " 1", "1.", ".5", "1.5 --no-sandbox"]) {
      expect(findUnsafeSwitch([EXE, `--force-device-scale-factor=${value}`]), value).toBe("force-device-scale-factor");
    }
    expect(findUnsafeSwitch([EXE, "--force-device-scale-factor"])).toBe("force-device-scale-factor");
    expect(findUnsafeSwitch([EXE, "--disable-gpu=1"])).toBe("disable-gpu");
  });

  it("finds a switch in every form Chromium accepts on Windows", () => {
    expect(findUnsafeSwitch([EXE, "--remote-debugging-port=9222"])).toBe("remote-debugging-port");
    expect(findUnsafeSwitch([EXE, "-no-sandbox"])).toBe("no-sandbox");
    expect(findUnsafeSwitch([EXE, "/inspect"])).toBe("inspect");
    expect(findUnsafeSwitch([EXE, "--Disable-Web-Security"])).toBe("disable-web-security");
  });

  it("finds a switch behind spaces, as Chromium trims them first (audit run 7)", () => {
    expect(findUnsafeSwitch([EXE, " --remote-debugging-port=9222"])).toBe("remote-debugging-port");
    expect(findUnsafeSwitch([EXE, "\t-no-sandbox"])).toBe("no-sandbox");
    expect(findUnsafeSwitch([EXE, " /inspect"])).toBe("inspect");
    expect(findUnsafeSwitch([EXE, "  --disable-gpu"])).toBeUndefined();
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
    "--disable-gpu-sandbox",
    "--in-process-gpu",
    "--ignore-gpu-blocklist",
    "--use-gl=swiftshader",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--constructor",
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

describe("clearUnsafeEnvironment", () => {
  it("drops the variables that would write TLS keys or Chromium's log to a file, in any case, and nothing else", () => {
    const env: Record<string, string | undefined> = { SSLKEYLOGFILE: "C:\\keys.txt", electron_enable_logging: "1", ELECTRON_LOG_FILE: "C:\\log.txt", PATH: "C:\\Windows", TAVORA_DEV_SERVER: "x" };
    clearUnsafeEnvironment(env);
    expect(env).toEqual({ PATH: "C:\\Windows", TAVORA_DEV_SERVER: "x" });
  });

  it("is wired into index.ts for a packaged Tavora, right after the switch gate", () => {
    const source = readFileSync(path.join(import.meta.dirname, "index.ts"), "utf8");
    const gate = source.indexOf("quitOnUnsafeSwitches({");
    const clear = source.indexOf("if (app.isPackaged) clearUnsafeEnvironment(process.env);");
    expect(gate).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(gate);
    // Before anything that could start a helper process.
    expect(clear).toBeLessThan(source.indexOf("app.enableSandbox()"));
  });
});
