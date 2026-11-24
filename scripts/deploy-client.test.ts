import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOBS, PROTOCOL, localTar, parseHello, sshCommand, staleSetup, target } from "./deploy-client.mjs";

const sha = (c: string) => c.repeat(64);

describe("target", () => {
  const env = { TAVORA_DEPLOY_HOST: "hetzner", TAVORA_UPDATES_SSH_KEY: "C:\\keys\\tavora-updates" };

  it("uses the job's own user and key", () => {
    expect(target(env, "updates")).toMatchObject({ problems: [], host: "hetzner", user: "tavora-updates", key: "C:\\keys\\tavora-updates" });
  });

  it("refuses a host with a user in it (the old root@host setting)", () => {
    expect(target({ ...env, TAVORA_DEPLOY_HOST: "root@hetzner" }, "updates").problems.join(" ")).toContain("host name only");
  });

  it("refuses the old root key", () => {
    const old = { ...env, TAVORA_DEPLOY_SSH_KEY: "C:\\keys\\tavora-updates" };
    expect(target(old, "updates").problems.join(" ")).toContain("old root key");
  });

  it("says which setting is missing", () => {
    expect(target({}, "docs").problems.join(" ")).toMatch(/TAVORA_DEPLOY_HOST.*TAVORA_DOCS_SSH_KEY/);
    expect(target(env, "nope").problems[0]).toContain("Unknown deploy job");
  });
});

describe("parseHello", () => {
  it("reads the banner and the installed files", () => {
    const answer = parseHello(`tavora-receive ${PROTOCOL} api\ninstalled ${sha("a")}  deploy/server/tavora-receive\r\n`, "api");
    expect(answer.error).toBeUndefined();
    expect(answer.installed?.get("deploy/server/tavora-receive")).toBe(sha("a"));
  });

  it("refuses a key that opened a shell instead of the receiver", () => {
    expect(parseHello("bash: line 1: hello: command not found\n", "updates").error).toContain("restricted deploy key");
    expect(parseHello("", "updates").error).toContain("did not answer as tavora-receive");
  });

  it("refuses another job's key and another protocol", () => {
    expect(parseHello(`tavora-receive ${PROTOCOL} docs\n`, "updates").error).toContain("belongs to the docs job");
    expect(parseHello(`tavora-receive ${PROTOCOL + 1} updates\n`, "updates").error).toContain("protocol");
  });
});

describe("staleSetup", () => {
  const installed = new Map([
    ["deploy/server/tavora-receive", sha("a")],
    ["deploy/server/tavora-api-switch", sha("b")],
    ["apps/api/deploy/tavora-api.service", sha("c")],
    ["deploy/server/setup-deploy-access.sh", sha("d")],
    ["deploy/server/tavora-update-signature", sha("e")],
    ["apps/desktop/src/main/update-keys.ts", sha("9")],
  ]);
  const same = (file: string) => installed.get(file) ?? null;

  it("is empty when the server matches the repo", () => {
    for (const job of Object.keys(JOBS)) expect(staleSetup(job, installed, same)).toEqual([]);
  });

  it("names only the files the job depends on", () => {
    const changed = (file: string) => (file === "apps/api/deploy/tavora-api.service" ? sha("f") : same(file));
    expect(staleSetup("api", installed, changed)).toEqual(["apps/api/deploy/tavora-api.service"]);
    expect(staleSetup("docs", installed, changed)).toEqual([]);
  });

  it("ignores a newer setup script alone", () => {
    const changed = (file: string) => (file === "deploy/server/setup-deploy-access.sh" ? sha("f") : same(file));
    expect(staleSetup("updates", installed, changed)).toEqual([]);
  });

  it("wants the receiver listed at all", () => {
    expect(staleSetup("docs", new Map(), same)).toEqual(["deploy/server/tavora-receive"]);
  });

  it("wants the update signature check and the pinned keys on the server before an update goes up", () => {
    const keys = "apps/desktop/src/main/update-keys.ts";
    const check = "deploy/server/tavora-update-signature";
    const before = new Map([...installed].filter(([file]) => file !== keys && file !== check));
    expect(staleSetup("updates", before, same)).toEqual([keys, check]);
    expect(staleSetup("docs", before, same)).toEqual([]);
    // New pins in the repo: the server must take them first.
    expect(staleSetup("updates", installed, (file) => (file === keys ? sha("1") : same(file)))).toEqual([keys]);
    expect(staleSetup("docs", installed, (file) => (file === keys ? sha("1") : same(file)))).toEqual([]);
  });
});

describe("the local ssh and tar", () => {
  it("uses Windows' own on Windows and the system's elsewhere (the Mac can deploy too)", () => {
    expect(sshCommand("win32")).toBe("ssh.exe");
    expect(sshCommand("darwin")).toBe("ssh");
    expect(sshCommand("linux")).toBe("ssh");
    expect(localTar("win32", { SystemRoot: "C:\\Windows" }).command).toBe(path.join("C:\\Windows", "System32", "tar.exe"));
    expect(localTar("darwin", { PATH: "/usr/bin" })).toEqual({ command: "tar", flags: ["--no-xattrs", "--no-mac-metadata"], env: { PATH: "/usr/bin", COPYFILE_DISABLE: "1" } });
    expect(localTar("linux", { PATH: "/usr/bin" })).toEqual({ command: "tar", flags: [], env: { PATH: "/usr/bin" } });
  });

  // The server refuses any name starting with a dot, and macOS's tar packs extended attributes (as ._ files or pax headers).
  it.runIf(process.platform === "darwin")("packs no extended attributes on macOS", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "deploy-tar-"));
    writeFileSync(path.join(dir, "latest.yml"), "version: 1.0.0\n");
    expect(spawnSync("xattr", ["-w", "com.tavora.test", "yes", path.join(dir, "latest.yml")]).status).toBe(0);
    const tar = localTar();
    const bundle = path.join(dir, "out.tar");
    expect(spawnSync(tar.command, [...tar.flags, "-cf", bundle, "-C", dir, "latest.yml"], { env: tar.env }).status).toBe(0);
    expect(spawnSync(tar.command, ["-tf", bundle], { encoding: "utf8" }).stdout.trim().split("\n")).toEqual(["latest.yml"]);
    expect(readFileSync(bundle, "latin1")).not.toMatch(/xattr|com\.tavora/);
  });
});
