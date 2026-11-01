import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeLastPlayed, parseLastPlayed, parseVdf, readSteamLastPlayed } from "./steam-played";

const CONFIG = `"UserLocalConfigStore"
{
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"AutoLoginUser"		"someone"
				"apps"
				{
					"730"
					{
						"LastPlayed"		"1761000000"
						"Playtime"		"1200"
					}
					"1245620"
					{
						"cloud"
						{
							"last_sync_state"		"synchronized"
						}
						"LastPlayed"		"1730000000"
					}
					"2246340"
					{
						"LastPlayed"		"0"
					}
					"570"
					{
						"Playtime"		"5"
					}
				}
			}
		}
	}
	"friends"
	{
		"apps"
		{
			"999"
			{
				"LastPlayed"		"1761000001"
			}
		}
	}
}`;

describe("parseVdf", () => {
  it("reads nested blocks, escapes and comments", () => {
    const vdf = parseVdf(`"a" { "b" "x\\"y" // note\n "c" { "d" "1" } }`);
    expect(vdf).toEqual({ a: { b: 'x"y', c: { d: "1" } } });
  });

  it("keeps what came before a cut-off file", () => {
    expect(parseVdf(`"a" { "b" "1" "c" { "d"`)).toEqual({ a: { b: "1", c: {} } });
  });

  it("does not nest without end", () => {
    const deep = `"a" {`.repeat(5000);
    expect(() => parseVdf(deep)).not.toThrow();
  });
});

describe("parseLastPlayed", () => {
  it("reads LastPlayed per game from Steam's apps block only", () => {
    const played = parseLastPlayed(CONFIG);
    expect([...played]).toEqual([
      [730, 1761000000],
      [1245620, 1730000000],
    ]);
  });

  it("finds nothing in a file that is not a localconfig", () => {
    expect(parseLastPlayed("not vdf at all").size).toBe(0);
    expect(parseLastPlayed("").size).toBe(0);
  });

  it("ignores dates that cannot be real", () => {
    const text = `"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "1" { "LastPlayed" "12" } "2" { "LastPlayed" "abc" } "3" { "LastPlayed" "99999999999" } } } } } }`;
    expect(parseLastPlayed(text).size).toBe(0);
  });
});

describe("mergeLastPlayed", () => {
  it("keeps the latest play over several accounts", () => {
    const merged = mergeLastPlayed([new Map([[1, 100]]), new Map([[1, 300], [2, 50]]), new Map([[1, 200]])]);
    expect([...merged].sort()).toEqual([
      [1, 300],
      [2, 50],
    ]);
  });
});

describe("readSteamLastPlayed", () => {
  it("reads every account's file and skips the ones it cannot read", async () => {
    const steam = await mkdtemp(path.join(tmpdir(), "tavora-steam-"));
    try {
      await mkdir(path.join(steam, "userdata", "111", "config"), { recursive: true });
      await mkdir(path.join(steam, "userdata", "222", "config"), { recursive: true });
      await mkdir(path.join(steam, "userdata", "notanid"), { recursive: true });
      await writeFile(path.join(steam, "userdata", "111", "config", "localconfig.vdf"), CONFIG);
      await writeFile(path.join(steam, "userdata", "222", "config", "localconfig.vdf"), CONFIG.replace("1761000000", "1762000000"));
      const played = await readSteamLastPlayed(steam);
      expect(played.get(730)).toBe(1762000000);
      expect(played.get(1245620)).toBe(1730000000);
    } finally {
      await rm(steam, { recursive: true, force: true });
    }
  });

  it("gives nothing without a userdata folder", async () => {
    expect((await readSteamLastPlayed(path.join(tmpdir(), "tavora-no-steam-here"))).size).toBe(0);
  });
});
