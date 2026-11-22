import { describe, expect, it } from "vitest";
import { isSafeEntryName, writeZip, zipDirectory, zipDirectoryAt } from "./zip";

/** The same zip with its directory padded: every entry gets the longest extra field a zip can hold. */
function paddedDirectory(zip: Buffer): Buffer {
  const endAt = zip.length - 22;
  const count = zip.readUInt16LE(endAt + 10);
  const size = zip.readUInt32LE(endAt + 12);
  const start = zip.readUInt32LE(endAt + 16);
  const parts = [zip.subarray(0, start)];
  let at = start;
  for (let index = 0; index < count; index++) {
    const nameLength = zip.readUInt16LE(at + 28);
    const header = Buffer.from(zip.subarray(at, at + 46 + nameLength));
    header.writeUInt16LE(0xffff, 30);
    parts.push(header, Buffer.alloc(0xffff));
    at += 46 + nameLength;
  }
  const end = Buffer.from(zip.subarray(endAt));
  end.writeUInt32LE(size + count * 0xffff, 12);
  return Buffer.concat([...parts, end]);
}

describe("zipDirectoryAt", () => {
  const files = Array.from({ length: 80 }, (_, index) => ({ name: `dir/file${index}.txt`, data: Buffer.from(`file ${index}`) }));

  it("lists what the full reader lists, reading only small pieces", () => {
    const zip = writeZip(files);
    expect(zipDirectoryAt(zip.length, (at, length) => zip.subarray(at, at + length))).toEqual(zipDirectory(zip));
  });

  it("still lists every file of a zip with a padded directory, without holding that directory", () => {
    const zip = paddedDirectory(writeZip(files));
    expect(zip.length).toBeGreaterThan(5 * 1024 * 1024);
    let longest = 0;
    const listed = zipDirectoryAt(zip.length, (at, length) => {
      longest = Math.max(longest, length);
      return zip.subarray(at, at + length);
    });
    expect(listed).toEqual(zipDirectory(zip));
    expect(listed).toHaveLength(80);
    expect(longest).toBeLessThanOrEqual(22 + 0xffff);
  });

  it("refuses a directory that runs past its end", () => {
    const zip = Buffer.from(writeZip(files));
    zip.writeUInt16LE(81, zip.length - 22 + 10);
    expect(() => zipDirectoryAt(zip.length, (at, length) => zip.subarray(at, at + length))).toThrow(/damaged/);
  });
});

describe("isSafeEntryName", () => {
  it("refuses a part Windows keeps for a device, also with an extension, a superscript digit or as CONIN$", () => {
    for (const name of ["COM1.x", "dist/NUL.a", "con.txt", "assets/COM¹", "CONIN$", "conout$/a.js", "lpt³.png"]) expect(isSafeEntryName(name), name).toBe(false);
  });

  it("lets through names that only start like one", () => {
    for (const name of ["dist/console.js", "COM10.txt", "assets/nullify.png"]) expect(isSafeEntryName(name), name).toBe(true);
  });
});
