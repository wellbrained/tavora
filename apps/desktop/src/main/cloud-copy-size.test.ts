// The PC counts a copy's size the way the service does (a part counts for at least MIN_PART_BYTES), so the check against
// the limit and the "leave pictures out" fallback agree with what the service answers.
import { afterEach, describe, expect, it } from "vitest";
import { CloudCopy, countedSize, MIN_PART_BYTES, PART_BYTES, type CopyStorage } from "./cloud-copy";
import { cleanUp, pc } from "./cloud-copy.test-helper";

afterEach(cleanUp);

/** A storage that takes everything and has the given limit. */
function storage(limit: number): CopyStorage & { sent: number } {
  const taken = { sent: 0 };
  return Object.assign(taken, {
    limit,
    arrivesLate: false,
    remote: async () => null,
    manifest: async () => null,
    putParts: async (parts: { data: Buffer }[]) => void (taken.sent += parts.length),
    getParts: async () => [],
    nextVersion: () => null,
    swap: async () => ({ status: "saved" as const, version: 1, size: 1 }),
  }) as unknown as CopyStorage & { sent: number };
}

describe("the size a copy counts for", () => {
  it("counts every part for at least what the service counts", async () => {
    const api = await import(/* @vite-ignore */ new URL("../../../api/src/cloud-copy.ts", import.meta.url).href);
    expect(MIN_PART_BYTES).toBe(api.MIN_PART_BYTES);
    expect(PART_BYTES).toBeGreaterThan(MIN_PART_BYTES);
  });

  it("counts small and empty files as one part of at least the minimum, and big ones part by part", () => {
    expect(countedSize([{ size: 0 }, { size: 100 }])).toBe(2 * MIN_PART_BYTES);
    expect(countedSize([{ size: PART_BYTES }])).toBe(PART_BYTES);
    expect(countedSize([{ size: PART_BYTES + 10 }])).toBe(PART_BYTES + MIN_PART_BYTES);
  });

  it("leaves pictures out when many small files make the copy too big only the way the service counts it", async () => {
    const small = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`module-data/x/note-${index}.json`, "x".repeat(100)]));
    const at = await pc({ ...small, "module-blobs/official/a.png": "p".repeat(3000) });
    const roots = at.roots;
    // Real bytes: about 4,000; as the service counts them: 10 x 1 KiB + 3,000 = 13,240.
    const answer = await new CloudCopy(storage(12_000)).upload(new Uint8Array(32).fill(7), roots, { version: 0, pictures: true, files: {} });
    expect(answer.status).toBe("uploaded");
    if (answer.status === "uploaded") expect(answer.pictures).toBe(false);
  });
});
