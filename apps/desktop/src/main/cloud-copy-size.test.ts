// The PC counts a copy's size the way the service does (a part counts for at least MIN_PART_BYTES), so the check against
// the limit and the "leave pictures out" fallback agree with what the service answers.
import { afterEach, describe, expect, it } from "vitest";
import { CloudCopy, countedParts, countedSize, MIN_PART_BYTES, PART_BYTES, scanCopy, type CopyStorage } from "./cloud-copy";
import { SEAL_OVERHEAD } from "./copy-crypto";
import { cleanUp, pc } from "./cloud-copy.test-helper";

afterEach(cleanUp);

/** A storage that takes everything and has the given limit. */
function storage(limit: number, swaps: ((manifest: Uint8Array) => unknown)[] = []): CopyStorage & { sent: number; swaps: number } {
  const taken = { sent: 0, swaps: 0 };
  return Object.assign(taken, {
    limit,
    arrivesLate: false,
    remote: async () => null,
    manifest: async () => null,
    putParts: async (parts: { data: Buffer }[]) => void (taken.sent += parts.length),
    getParts: async () => [],
    nextVersion: () => null,
    swap: async (_base: number, _version: number | null, _ids: string[], manifest: Uint8Array) => {
      const answer = swaps[taken.swaps]?.(manifest);
      taken.swaps++;
      return answer ?? { status: "saved" as const, version: 1, size: 1 };
    },
  }) as unknown as CopyStorage & { sent: number; swaps: number };
}

describe("the size a copy counts for", () => {
  it("counts every part for at least what the service counts", async () => {
    const api = await import(/* @vite-ignore */ new URL("../../../api/src/cloud-copy.ts", import.meta.url).href);
    expect(MIN_PART_BYTES).toBe(api.MIN_PART_BYTES);
    expect(PART_BYTES).toBeGreaterThan(MIN_PART_BYTES);
  });

  it("counts small and empty files as one part of at least the minimum, and big ones part by part", () => {
    expect(countedParts([{ size: 0 }, { size: 100 }])).toBe(2 * MIN_PART_BYTES);
    expect(countedParts([{ size: PART_BYTES }])).toBe(PART_BYTES + SEAL_OVERHEAD);
    expect(countedParts([{ size: PART_BYTES + 10 }])).toBe(PART_BYTES + SEAL_OVERHEAD + MIN_PART_BYTES);
  });

  it("counts the sealed list on top, never less than the real one", async () => {
    const files = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`module-data/x/note-${index}.json`, `{"n":${index}}`]));
    const at = await pc({ ...files, "module-blobs/official/a.png": "p".repeat(5000) });
    let sealed = 0;
    const answer = await new CloudCopy(storage(10_000_000, [(manifest) => void (sealed = manifest.length)])).upload(new Uint8Array(32).fill(7), at.roots, { version: 0, pictures: true, files: {} });
    expect(answer.status).toBe("uploaded");
    const found = await scanCopy(at.roots);
    expect(countedSize(found) - countedParts(found)).toBeGreaterThanOrEqual(sealed);
  });

  it("tries once more without pictures when the service says too big with them", async () => {
    const at = await pc({ "module-data/x/a.json": "{}", "module-blobs/official/a.png": "p".repeat(3000) });
    const via = storage(10_000_000, [() => ({ status: "too-big", size: 99 })]);
    const answer = await new CloudCopy(via).upload(new Uint8Array(32).fill(7), at.roots, { version: 0, pictures: true, files: {} });
    expect(answer).toMatchObject({ status: "uploaded", pictures: false });
    expect(via.swaps).toBe(2);
    // With no pictures to leave out, it stays too big.
    const bare = await pc({ "module-data/x/a.json": "{}" });
    const still = storage(10_000_000, [() => ({ status: "too-big", size: 99 })]);
    expect(await new CloudCopy(still).upload(new Uint8Array(32).fill(7), bare.roots, { version: 0, pictures: true, files: {} })).toMatchObject({ status: "too-big" });
    expect(still.swaps).toBe(1);
  });

  it("leaves pictures out when many small files make the copy too big only the way the service counts it", async () => {
    const small = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`module-data/x/note-${index}.json`, "x".repeat(100)]));
    const at = await pc({ ...small, "module-blobs/official/a.png": "p".repeat(8000) });
    const roots = at.roots;
    // Real bytes: about 9,000; as the service counts them (1 KiB per small part, the list on top): over 18,000 with the picture, under without.
    const answer = await new CloudCopy(storage(18_000)).upload(new Uint8Array(32).fill(7), roots, { version: 0, pictures: true, files: {} });
    expect(answer.status).toBe("uploaded");
    if (answer.status === "uploaded") expect(answer.pictures).toBe(false);
  });
});
