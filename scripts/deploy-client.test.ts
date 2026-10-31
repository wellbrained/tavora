import { describe, expect, it } from "vitest";
import { JOBS, PROTOCOL, parseHello, staleSetup, target } from "./deploy-client.mjs";

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
});
