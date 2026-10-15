import { describe, expect, it } from "vitest";
import { AppInfoError, readClientIcons } from "./steam-appinfo";
import { appInfo, Bytes, type FakeApp } from "./steam-appinfo.fixture";

const HASH_A = "a".repeat(40);
const HASH_B = "0123456789abcdef0123456789abcdef01234567";

const wanted = (...ids: number[]) => new Set(ids);

describe("readClientIcons", () => {
  const apps: FakeApp[] = [
    { appid: 10, common: { name: "Other", clienticon: HASH_B } },
    { appid: 20, common: { name: "Game", type: "game", clienticon: HASH_A, nested: { depth: 1, more: { deeper: "yes" } } } },
    { appid: 30, common: { name: "No icon" } },
    { appid: 40, common: { name: "Bad hash", clienticon: "NOT-A-HASH" } },
    { appid: 50, common: { name: "Upper case", clienticon: HASH_A.toUpperCase() } },
    { appid: 60 },
  ];

  it.each([39, 40, 41] as const)("finds the hashes of the wanted apps, version %d", (version) => {
    const found = readClientIcons(appInfo(version, apps), wanted(20, 10, 30, 40, 50, 60, 70));
    expect(Object.fromEntries(found)).toEqual({ 10: HASH_B, 20: HASH_A });
  });

  it("answers only for the apps it was asked about", () => {
    expect([...readClientIcons(appInfo(41, apps), wanted(20))]).toEqual([[20, HASH_A]]);
    expect(readClientIcons(appInfo(41, apps), wanted()).size).toBe(0);
  });

  it("reads past values of every kind without losing its place", () => {
    const body = new Bytes();
    const key = (name: string) => body.u32(name === "appinfo" ? 0 : name === "common" ? 1 : name === "clienticon" ? 2 : 3);
    body.raw(new Array(60).fill(0)).u8(0x00);
    key("appinfo");
    body.u8(0x00);
    key("common");
    body.u8(0x03).u32(3).u32(0x3f800000); // float
    body.u8(0x04).u32(3).u32(5); // pointer
    body.u8(0x05).u32(3).raw([0x41, 0, 0x42, 0, 0, 0]); // wide string "AB"
    body.u8(0x06).u32(3).u32(0xff00ff00); // colour
    body.u8(0x07).u32(3).u64(7); // unsigned 64 bit
    body.u8(0x0a).u32(3).u64(7); // signed 64 bit
    body.u8(0x01).u32(2).cstr(HASH_A); // clienticon
    body.u8(0x08).u8(0x08).u8(0x08);
    const out = new Bytes().u32(41 | (0x075644 << 8)).u32(1).u64(0).u32(77).u32(body.length).raw(body.data).u32(0);
    const tableAt = out.length;
    out.u32(4).cstr("appinfo").cstr("common").cstr("clienticon").cstr("other");
    out.data.splice(8, 4, ...new Bytes().u32(tableAt).data);
    expect(readClientIcons(new Uint8Array(out.data), wanted(77)).get(77)).toBe(HASH_A);
  });

  it("loses only the damaged app, not the ones after it", () => {
    const damaged: FakeApp[] = [
      { appid: 1, rawKeyValues: [0x00, 0xff, 0xff, 0xff, 0x7f, 0x01, 0x00] }, // a key number that is not in the table
      { appid: 2, rawKeyValues: [0x09, 0x00] }, // a value of an unknown kind
      { appid: 3, rawKeyValues: [0x00] }, // ends in the middle of a name
      { appid: 4, common: { clienticon: HASH_A } },
    ];
    const found = readClientIcons(appInfo(41, damaged), wanted(1, 2, 3, 4));
    expect(Object.fromEntries(found)).toEqual({ 4: HASH_A });
  });

  it("gives up on objects nested too deeply", () => {
    const deep = [0x00, 0, 0, 0, 0];
    for (let i = 0; i < 40; i += 1) deep.push(0x00, 0, 0, 0, 0);
    expect(readClientIcons(appInfo(41, [{ appid: 1, rawKeyValues: deep }, { appid: 2, common: { clienticon: HASH_A } }]), wanted(1, 2)).size).toBe(1);
  });

  it("refuses files that are not appinfo.vdf, or damaged as a whole", () => {
    const good = appInfo(41, apps);
    expect(() => readClientIcons(new Uint8Array(8), wanted(20))).toThrow(AppInfoError);
    expect(() => readClientIcons(new Uint8Array(32), wanted(20))).toThrow(/not an appinfo/);
    const wrongVersion = good.slice();
    wrongVersion[0] = 42;
    expect(() => readClientIcons(wrongVersion, wanted(20))).toThrow(/not supported/);
    const wrongTable = good.slice();
    wrongTable.set(new Bytes().u32(0xffffff).data, 8);
    expect(() => readClientIcons(wrongTable, wanted(20))).toThrow(/name table/);
    // An entry whose size reaches past the end of the file.
    const longEntry = good.slice();
    longEntry.set(new Bytes().u32(0x7fffffff).data, 20);
    expect(() => readClientIcons(longEntry, wanted(20, 999))).toThrow(/does not fit/);
    expect(() => readClientIcons(good.slice(0, 40), wanted(20))).toThrow(AppInfoError);
  });
});
