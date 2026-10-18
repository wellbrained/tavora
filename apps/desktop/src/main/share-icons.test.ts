import { describe, expect, it } from "vitest";
import type { HostedList } from "./hosted-icons";
import {
  isOriginalIconFile,
  isShareCandidate,
  icoFrameNear,
  largestIcoFrame,
  shareableIconFile,
  shareSource,
  steamShareGames,
  submitIcon,
  type ShareGame,
} from "./share-icons";

describe("original icon files", () => {
  it("are the installed game's and Steam's own .ico, and nothing else", () => {
    for (const file of ["exe-diablo-iv.ico", "exe-local-x.ico", "1245620.ico"]) expect(isOriginalIconFile(file)).toBe(true);
    for (const file of ["hosted-diablo-iv.png", "1245620.jpg", "exe-diablo-iv.png", "../1.ico", "exe-.ico", "", null]) {
      expect(isOriginalIconFile(file)).toBe(false);
    }
  });

  it("say where they came from", () => {
    expect(shareSource("exe-diablo-iv.ico")).toBe("installed");
    expect(shareSource("1245620.ico")).toBe("steam");
  });
});

describe("what can be shared", () => {
  const list: HostedList = {
    notice: "",
    takedown: "",
    icons: [{ id: "starcraft-2", names: ["StarCraft II"], sha256: "a".repeat(64), size: 1 }],
  };
  const on = { steamIcons: true, onlineSearch: true, iconsOffered: [] as string[] };
  const game = (over: Partial<ShareGame> = {}): ShareGame => ({
    id: "diablo-iv",
    name: "Diablo IV",
    catalogId: null,
    trashedAt: null,
    iconFile: "exe-diablo-iv.ico",
    iconSharedAt: null,
    ...over,
  });

  it("offers the game's own icon when the service does not have one for the game", () => {
    expect(shareableIconFile(game(), on, list)).toBe("exe-diablo-iv.ico");
    expect(shareableIconFile(game({ id: "elden-ring", name: "Elden Ring", iconFile: "1245620.ico" }), on, list)).toBe("1245620.ico");
  });

  it("offers nothing for a game the service already has, by id, built-in id or name", () => {
    expect(shareableIconFile(game({ id: "starcraft-2", name: "Anything", iconFile: "exe-starcraft-2.ico" }), on, list)).toBeNull();
    expect(shareableIconFile(game({ id: "x", catalogId: "starcraft-2", iconFile: "exe-x.ico" }), on, list)).toBeNull();
    expect(shareableIconFile(game({ id: "other", name: "StarCraft 2", iconFile: "exe-other.ico" }), on, list)).toBeNull();
  });

  it("never offers a picture the player chose, a hosted icon or Steam's small one", () => {
    for (const iconFile of ["hosted-diablo-iv.png", "1245620.jpg", null]) expect(shareableIconFile(game({ iconFile }), on, list)).toBeNull();
  });

  it("offers nothing for a custom game, one in Trash or one already offered", () => {
    expect(shareableIconFile(game({ id: "local-diablo-iv" }), on, list)).toBeNull();
    expect(shareableIconFile(game({ trashedAt: "2026-10-15T00:00:00.000Z" }), on, list)).toBeNull();
    expect(shareableIconFile(game({ iconSharedAt: "2026-10-15T00:00:00.000Z" }), on, list)).toBeNull();
    expect(isShareCandidate(game({ id: "local-x" }))).toBe(false);
    expect(isShareCandidate(game())).toBe(true);
  });

  it("offers nothing while the list is unknown or the player has switched online features or icons off", () => {
    expect(shareableIconFile(game(), on, null)).toBeNull();
    expect(shareableIconFile(game(), { ...on, onlineSearch: false }, list)).toBeNull();
    expect(shareableIconFile(game(), { ...on, steamIcons: false }, list)).toBeNull();
  });

  it("offers nothing for a game whose icon was offered before it was added", () => {
    expect(shareableIconFile(game(), { ...on, iconsOffered: ["diablo-iv"] }, list)).toBeNull();
  });
});

describe("sharing from a Steam import without adding games", () => {
  const list: HostedList = {
    notice: "",
    takedown: "",
    icons: [{ id: "starcraft-2", names: ["StarCraft II"], sha256: "a".repeat(64), size: 1 }],
  };
  const games = [
    { appid: 1, name: "Elden Ring", id: "elden-ring" },
    { appid: 2, name: "StarCraft II", id: "sc2-steam" },
    { appid: 3, name: "Unknown", id: null },
    { appid: 4, name: "Owned", id: "owned" },
    { appid: 5, name: "Offered", id: "offered" },
    { appid: 6, name: "Custom", id: "local-custom" },
    { appid: 7, name: "Elden Ring again", id: "elden-ring" },
  ];

  it("keeps the new games with a known id that the service has no icon for and that were not offered", () => {
    const found = steamShareGames(games, (game) => game.id !== "owned", ["offered"], list);
    expect(found.map((game) => game.appid)).toEqual([1]);
  });
});

/** An .ico with these frames: [pixel size, data]; 256 is stored as 0, as in real files. */
function ico(...frames: Array<[number, Uint8Array]>): Uint8Array {
  const header = 6 + frames.length * 16;
  const out = new Uint8Array(header + frames.reduce((sum, [, data]) => sum + data.byteLength, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, frames.length, true);
  let offset = header;
  frames.forEach(([size, data], i) => {
    const at = 6 + i * 16;
    out[at] = size >= 256 ? 0 : size;
    out[at + 1] = size >= 256 ? 0 : size;
    out[at + 4] = 1;
    out[at + 6] = 32;
    view.setUint32(at + 8, data.byteLength, true);
    view.setUint32(at + 12, offset, true);
    out.set(data, offset);
    offset += data.byteLength;
  });
  return out;
}
const bytes = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (i * 7 + seed) % 256);

describe("largestIcoFrame", () => {
  it("keeps only the biggest frame, unchanged, as a valid one-frame icon", () => {
    const big = bytes(500, 3);
    const out = largestIcoFrame(ico([16, bytes(80, 1)], [256, big], [48, bytes(200, 2)]))!;
    const view = new DataView(out.buffer);
    expect(view.getUint16(4, true)).toBe(1);
    expect(out[6]).toBe(0);
    expect(view.getUint32(6 + 8, true)).toBe(500);
    expect(view.getUint32(6 + 12, true)).toBe(22);
    expect(out.slice(22)).toEqual(big);
    expect(out.byteLength).toBe(22 + 500);
  });

  it("keeps the one frame of a one-frame icon", () => {
    const only = bytes(64, 5);
    expect(largestIcoFrame(ico([32, only]))!.slice(22)).toEqual(only);
  });

  it("skips a frame that points outside the file, and gives null when none is left", () => {
    const good = ico([16, bytes(40, 1)], [64, bytes(100, 2)]);
    const lying = good.slice();
    new DataView(lying.buffer).setUint32(6 + 16 + 12, 99999, true);
    expect(largestIcoFrame(lying)!.slice(22)).toEqual(bytes(40, 1));
    const allLying = lying.slice();
    new DataView(allLying.buffer).setUint32(6 + 12, 99999, true);
    expect(largestIcoFrame(allLying)).toBeNull();
  });

  it("gives null for anything that is not an icon", () => {
    for (const bad of [new Uint8Array(0), new Uint8Array(30), new TextEncoder().encode("not an icon, just some text bytes!!"), ico().slice(0, 4)]) {
      expect(largestIcoFrame(bad)).toBeNull();
    }
    const wrongType = ico([16, bytes(40, 1)]);
    new DataView(wrongType.buffer).setUint16(2, 2, true);
    expect(largestIcoFrame(wrongType)).toBeNull();
  });
});

describe("icoFrameNear", () => {
  it("keeps the smallest frame at least that big, else the biggest", () => {
    const icon = ico([16, bytes(10, 1)], [256, bytes(30, 2)], [48, bytes(20, 3)], [32, bytes(15, 4)]);
    expect(icoFrameNear(icon, 40)!.slice(22)).toEqual(bytes(20, 3));
    expect(icoFrameNear(icon, 32)!.slice(22)).toEqual(bytes(15, 4));
    expect(icoFrameNear(ico([16, bytes(10, 1)], [24, bytes(12, 2)]), 48)!.slice(22)).toEqual(bytes(12, 2));
  });
});

describe("submitIcon", () => {
  const offer = { id: "diablo-iv", name: "Diablo IV", source: "installed" as const, ico: ico([32, bytes(60, 4)]) };
  const answer = (status: number) => (async () => new Response("{}", { status })) as typeof fetch;

  it("posts the id, name, source and the icon as base64 JSON, with no cookies or referrer", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response("{}", { status: 202 }))) as unknown as typeof fetch;
    expect(await submitIcon({ baseUrl: "https://service.test/", fetchImpl }, offer)).toBe("sent");
    expect(seen!.url).toBe("https://service.test/v1/icons/submit");
    expect(seen!.init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    expect((seen!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(seen!.init.body as string) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["icon", "id", "name", "source"]);
    expect(body).toMatchObject({ id: "diablo-iv", name: "Diablo IV", source: "installed" });
    expect(new Uint8Array(Buffer.from(body.icon!, "base64"))).toEqual(offer.ico);
  });

  it("says skipped when the service will not take it, failed when it could not be asked", async () => {
    for (const status of [400, 409, 413]) expect(await submitIcon({ baseUrl: "https://x.test", fetchImpl: answer(status) }, offer)).toBe("skipped");
    expect(await submitIcon({ baseUrl: "https://x.test", fetchImpl: answer(429) }, offer)).toBe("busy");
    for (const status of [500, 503]) expect(await submitIcon({ baseUrl: "https://x.test", fetchImpl: answer(status) }, offer)).toBe("failed");
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await submitIcon({ baseUrl: "https://x.test", fetchImpl: offline }, offer)).toBe("failed");
  });
});
