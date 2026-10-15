import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchHostedList, matchHosted, MAX_HOSTED_ICON_BYTES, saveHostedIcon, type HostedIcon, type HostedList } from "./hosted-icons";

const png = (width = 256, height = 256, seed = 1) => {
  const bytes = new Uint8Array(80).fill(seed);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const answer = (body: unknown, init: ResponseInit = {}) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init)) as typeof fetch;
const BASE = "https://service.test/";

const listed = (over: Record<string, unknown> = {}) => ({ id: "diablo-iv", names: ["Diablo IV", "Diablo 4"], sha256: "a".repeat(64), size: 9000, ...over });

describe("fetchHostedList", () => {
  it("reads the list, the notice and the takedown contact", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => (asked.push(url), new Response(JSON.stringify({ notice: "Not affiliated.", takedown: "legal@example.test", icons: [listed()] })))) as unknown as typeof fetch;
    expect(await fetchHostedList({ baseUrl: BASE, fetchImpl })).toEqual({ notice: "Not affiliated.", takedown: "legal@example.test", icons: [listed()] });
    expect(asked).toEqual(["https://service.test/v1/icons"]);
  });

  it("sends no cookies or referrer and refuses redirects", async () => {
    let init: RequestInit | undefined;
    const fetchImpl = (async (_url: string, options: RequestInit) => ((init = options), new Response(JSON.stringify({ icons: [] })))) as unknown as typeof fetch;
    await fetchHostedList({ baseUrl: BASE, fetchImpl });
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
  });

  it("drops entries that are not trustworthy and keeps the rest", async () => {
    const icons = [
      listed(),
      listed(),
      listed({ id: "../x" }),
      listed({ id: "Upper" }),
      listed({ id: "no-hash", sha256: "abc" }),
      listed({ id: "no-names", names: [] }),
      listed({ id: "bad-names", names: [1, "", "  "] }),
      listed({ id: "too-big", size: MAX_HOSTED_ICON_BYTES + 1 }),
      listed({ id: "no-size", size: "9" }),
      listed({ id: "ok-two", names: ["Two"] }),
      null,
      "text",
    ];
    const list = await fetchHostedList({ baseUrl: BASE, fetchImpl: answer({ icons }) });
    expect(list?.icons.map((icon) => icon.id)).toEqual(["diablo-iv", "ok-two"]);
  });

  it("gives null when the service is down, answers badly or sends something else", async () => {
    expect(await fetchHostedList({ baseUrl: BASE, fetchImpl: answer({}, { status: 503 }) })).toBeNull();
    expect(await fetchHostedList({ baseUrl: BASE, fetchImpl: answer("not json") })).toBeNull();
    expect(await fetchHostedList({ baseUrl: BASE, fetchImpl: answer({ icons: "x" }) })).toBeNull();
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await fetchHostedList({ baseUrl: BASE, fetchImpl: offline })).toBeNull();
  });

  it("keeps an empty notice or contact empty rather than failing", async () => {
    const list = await fetchHostedList({ baseUrl: BASE, fetchImpl: answer({ icons: [listed()], notice: 5 }) });
    expect(list).toMatchObject({ notice: "", takedown: "" });
  });
});

describe("matchHosted", () => {
  const list: HostedList = {
    notice: "",
    takedown: "",
    icons: [
      { id: "diablo-iv", names: ["Diablo IV", "Diablo 4"], sha256: "a".repeat(64), size: 1 },
      { id: "starcraft-2", names: ["StarCraft II"], sha256: "b".repeat(64), size: 1 },
    ],
  };
  const game = (over: Partial<{ id: string; name: string; catalogId: string | null }> = {}) => ({ id: "local-x", name: "X", catalogId: null, ...over });

  it("matches by the game's own id and by the built-in game it is", () => {
    expect(matchHosted(game({ id: "diablo-iv", name: "Anything" }), list)?.id).toBe("diablo-iv");
    expect(matchHosted(game({ catalogId: "starcraft-2", name: "Anything" }), list)?.id).toBe("starcraft-2");
  });

  it("matches by name however it is spelled: case, punctuation, (R), roman numerals", () => {
    for (const name of ["Diablo IV", "diablo 4", "Diablo® IV", "DIABLO: IV", "Diablo  4 "]) expect(matchHosted(game({ name }), list)?.id).toBe("diablo-iv");
    expect(matchHosted(game({ name: "StarCraft 2" }), list)?.id).toBe("starcraft-2");
  });

  it("matches nothing for another game, another number or an empty name", () => {
    for (const name of ["Diablo III", "Diablo", "Overwatch", "", "!!!"]) expect(matchHosted(game({ name }), list)).toBeNull();
  });
});

describe("saveHostedIcon", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tavora-hosted-"));
    await mkdir(dir, { recursive: true });
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const iconFor = (bytes: Uint8Array): HostedIcon => ({ id: "diablo-iv", names: ["Diablo IV"], sha256: sha(bytes), size: bytes.byteLength });

  it("keeps the downloaded file unchanged under the game's own name", async () => {
    const bytes = png();
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => (asked.push(url), new Response(bytes as BodyInit))) as unknown as typeof fetch;
    expect(await saveHostedIcon(dir, "local-diablo", iconFor(bytes), { baseUrl: BASE, fetchImpl })).toEqual({ status: "saved", file: "hosted-local-diablo.png" });
    expect(asked).toEqual(["https://service.test/v1/icons/diablo-iv.png"]);
    expect(new Uint8Array(await readFile(path.join(dir, "hosted-local-diablo.png")))).toEqual(bytes);
  });

  it("refuses a file with another hash, that is not a small PNG, or that is too big", async () => {
    const good = png();
    const cases: Uint8Array[] = [png(256, 256, 9), png(257, 256), png(256, 0), new Uint8Array(200).fill(7), new Uint8Array(MAX_HOSTED_ICON_BYTES + 1).fill(1)];
    for (const bytes of cases) {
      const icon = { ...iconFor(good), sha256: sha(bytes) };
      expect(await saveHostedIcon(dir, "game", icon, { baseUrl: BASE, fetchImpl: answer(bytes as unknown as string) })).toEqual({ status: "none" });
    }
    expect(await saveHostedIcon(dir, "game", iconFor(good), { baseUrl: BASE, fetchImpl: answer(png(256, 256, 9) as unknown as string) })).toEqual({ status: "none" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses a file that declares itself too big before reading it", async () => {
    const bytes = png();
    const fetchImpl = (async () => new Response(bytes as BodyInit, { headers: { "content-length": String(MAX_HOSTED_ICON_BYTES + 1) } })) as unknown as typeof fetch;
    expect(await saveHostedIcon(dir, "game", iconFor(bytes), { baseUrl: BASE, fetchImpl })).toEqual({ status: "none" });
  });

  it("says none when the service no longer has it, and failed when it does not answer", async () => {
    const bytes = png();
    expect(await saveHostedIcon(dir, "game", iconFor(bytes), { baseUrl: BASE, fetchImpl: answer("", { status: 404 }) })).toEqual({ status: "none" });
    expect(await saveHostedIcon(dir, "game", iconFor(bytes), { baseUrl: BASE, fetchImpl: answer("", { status: 500 }) })).toEqual({ status: "failed" });
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await saveHostedIcon(dir, "game", iconFor(bytes), { baseUrl: BASE, fetchImpl: offline })).toEqual({ status: "failed" });
  });

  it("refuses a game id that cannot be part of a file name", async () => {
    const bytes = png();
    expect(await saveHostedIcon(dir, "../escape", iconFor(bytes), { baseUrl: BASE, fetchImpl: answer(bytes as unknown as string) })).toEqual({ status: "none" });
  });
});
