import { describe, expect, it } from "vitest";
import { Installed } from "./installed-modules";
import { ModuleBoards } from "./module-boards";
import type { InstalledModule } from "./registry";

function module(id: string, owner: string, boards = [{ id: "runs", name: "Runs", unit: "count" }]): InstalledModule {
  return { owner, root: `/modules/${id}`, provenance: "catalog", manifest: { id, name: id, version: "1.0.0", leaderboards: { boards } } } as unknown as InstalledModule;
}

function setup(modules: InstalledModule[], catalog: string[] = [], answer?: (method: string, path: string) => { status: number; body: Record<string, unknown> }) {
  const requests: string[] = [];
  const installed = new Installed({ modules: new Map(modules.map((item) => [item.manifest.id, item])), blocked: new Map(), catalog: new Set(catalog), info: new Map(), problems: [] }, (manifest) => manifest);
  const boards = new ModuleBoards({
    installed,
    account: {
      enabled: () => true,
      isSignedIn: () => true,
      leaderboardRequest: async (method, path) => {
        requests.push(`${method} ${path}`);
        if (answer) return answer(method, path);
        return { status: 200, body: { shown: true, name: "Nik", available: true } };
      },
    },
    language: () => "en",
  });
  return { boards, requests };
}

describe("ModuleBoards", () => {
  it("lets a module reach its own boards only when it is Tavora's or from the catalog", async () => {
    const listed = module("wellbrained.runs", "abcd1234");
    const copy = module("wellbrained.copy", "local");
    const { boards, requests } = setup([listed, copy], ["wellbrained.runs"]);
    await boards.of(listed, async () => false).status();
    await boards.of(copy, async () => false).status();
    expect(requests).toEqual([expect.stringContaining("wellbrained.runs"), expect.stringContaining("local.copy")]);
  });

  it("lists on the profile card only listed modules that have boards", async () => {
    const { boards, requests } = setup([module("wellbrained.runs", "abcd1234"), module("tavora.notes", "official", []), module("wellbrained.copy", "local")], ["wellbrained.runs"]);
    await boards.ranks();
    expect(requests.every((request) => request.includes("wellbrained.runs"))).toBe(true);
    expect(requests.length).toBeGreaterThan(0);
  });

  it("takes the user off a module's boards; says so when the service can't be reached, and does nothing for a module that is gone", async () => {
    const { boards, requests } = setup([module("wellbrained.runs", "abcd1234")], ["wellbrained.runs"]);
    await boards.leave("wellbrained.runs");
    expect(requests.some((request) => request.startsWith("DELETE") || request.startsWith("PUT") || request.startsWith("POST"))).toBe(true);
    await boards.leave("wellbrained.gone");

    const down = setup([module("wellbrained.runs", "abcd1234")], ["wellbrained.runs"], () => {
      throw new Error("offline");
    });
    await expect(down.boards.leave("wellbrained.runs")).rejects.toMatchObject({ key: "account.error.unreachable" });
  });
});
