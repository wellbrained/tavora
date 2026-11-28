import { describe, expect, it } from "vitest";
import { programPathOnce } from "./foreground";

describe("programPathOnce", () => {
  const game = { pid: 4242, startTime: 100 };
  const other = { pid: 77, startTime: 5 };

  it("asks a process once in its life, however often its windows come to the front", () => {
    const paths = new Map<string, string | null>();
    const asked: number[] = [];
    const ask = (pid: number) => (asked.push(pid), pid === 4242 ? "C:/Games/Game.exe" : null);
    for (let look = 0; look < 5; look++) {
      expect(programPathOnce(paths, [game, other], 4242, ask)).toBe("C:/Games/Game.exe");
      // One that said no isn't asked again either.
      expect(programPathOnce(paths, [game, other], 77, ask)).toBeNull();
    }
    expect(asked).toEqual([4242, 77]);
  });

  it("asks again for a new process on a reused id, and forgets processes that ended", () => {
    const paths = new Map<string, string | null>();
    let answer = "C:/Games/Old.exe";
    const ask = () => answer;
    programPathOnce(paths, [game, other], 4242, ask);
    answer = "C:/Games/New.exe";
    expect(programPathOnce(paths, [{ pid: 4242, startTime: 900 }], 4242, ask)).toBe("C:/Games/New.exe");
    expect([...paths.keys()]).toEqual(["4242:900"]);
  });

  it("asks without keeping when the list can't be read or doesn't have the process", () => {
    const paths = new Map<string, string | null>();
    let asked = 0;
    const ask = () => (asked++, "C:/x.exe");
    programPathOnce(paths, null, 4242, ask);
    programPathOnce(paths, [other], 4242, ask);
    expect(asked).toBe(2);
    expect(paths.size).toBe(0);
  });
});
