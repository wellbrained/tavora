import { describe, expect, it } from "vitest";
import { compareVersions, createProbes, parseLatestYml } from "./admin-probes.ts";

describe("versions", () => {
  it("compares numbers, not text", () => {
    expect(compareVersions("0.2.11", "0.2.7")).toBe(1);
    expect(compareVersions("0.2.7", "0.2.11")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("nonsense", "0.0.0")).toBe(0);
  });

  it("reads latest.yml", () => {
    const yml = "version: 0.21.13\nfiles:\n  - url: Tavora-Setup-0.21.13.exe\n    sha512: abc\n    size: 112175165\npath: Tavora-Setup-0.21.13.exe\nreleaseDate: '2026-10-25T23:04:17.232Z'\n";
    expect(parseLatestYml(yml)).toEqual({ version: "0.21.13", releasedAt: "2026-10-25T23:04:17.232Z", installerSize: 112175165 });
    expect(parseLatestYml("<html>")).toBeNull();
  });
});

describe("probes", () => {
  it("keep an answer for a minute, then ask again, and turn failures into nulls", async () => {
    let calls = 0;
    let time = 0;
    const probes = createProbes(
      (async () => {
        calls++;
        return new Response(JSON.stringify({ version: "1.2.3" }), { status: 200 });
      }) as typeof fetch,
      () => time,
    );
    expect(await probes.npmVersion("@tavora/sdk")).toBe("1.2.3");
    expect(await probes.npmVersion("@tavora/sdk")).toBe("1.2.3");
    expect(calls).toBe(1);
    time = 61_000;
    await probes.npmVersion("@tavora/sdk");
    expect(calls).toBe(2);
    const broken = createProbes((async () => {
      throw new Error("offline");
    }) as typeof fetch);
    expect(await broken.feed()).toBeNull();
    expect(await broken.mainVersion("packages/sdk")).toBeNull();
    expect(await broken.site("https://example.test")).toEqual({ ok: false, status: null });
  });
});
