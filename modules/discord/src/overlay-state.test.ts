import { describe, expect, it } from "vitest";
import { buildOverlayState, MAX_OVERLAY_NAME, MAX_ROWS, MAX_STATE_BYTES, stateBytes, type OverlayMember } from "./overlay-state";

const member = (n: number, extra: Partial<OverlayMember> = {}): OverlayMember => ({ id: String(100 + n), name: `Person ${n}`, tiny: null, speaking: false, muted: false, deafened: false, ...extra });
const crowd = (count: number, extra: (n: number) => Partial<OverlayMember> = () => ({})) => Array.from({ length: count }, (_, n) => member(n, extra(n)));
/** About what a 32 px webp avatar weighs as a data address. */
const picture = (n: number) => `data:image/webp;base64,${"A".repeat(1000 + n)}`;

describe("voice overlay state", () => {
  it("has no people for an empty channel", () => {
    expect(buildOverlayState([], { names: true })).toEqual({ v: 1, names: true, people: [], more: 0 });
  });

  it("keeps the channel's order and sets the flags only when they are true", () => {
    const state = buildOverlayState([member(1, { speaking: true }), member(2, { muted: true }), member(3, { deafened: true, muted: true }), member(4)], { names: true });
    expect(state.people.map((person) => person.n)).toEqual(["Person 1", "Person 2", "Person 3", "Person 4"]);
    expect(state.people[0]).toMatchObject({ s: 1 });
    expect(state.people[1]).toMatchObject({ m: 1 });
    // Deafened shows one icon, not two.
    expect(state.people[2]).toMatchObject({ d: 1 });
    expect(state.people[2]).not.toHaveProperty("m");
    expect(state.people[3]).not.toHaveProperty("s");
    expect(state.people[3]).not.toHaveProperty("m");
    expect(state.people[3]).not.toHaveProperty("d");
  });

  it("draws at most eight people and counts the rest, talkers first", () => {
    const state = buildOverlayState(crowd(12, (n) => ({ speaking: n === 10 })), { names: true });
    expect(state.people).toHaveLength(MAX_ROWS);
    expect(state.more).toBe(4);
    // The talker from far down is in; the list stays in the channel's order.
    expect(state.people.map((person) => person.n)).toEqual(["Person 0", "Person 1", "Person 2", "Person 3", "Person 4", "Person 5", "Person 6", "Person 10"]);
  });

  it("has no names when names are off, and initials in place of a missing picture", () => {
    const state = buildOverlayState([member(1), member(2, { tiny: picture(0) })], { names: false });
    expect(state.names).toBe(false);
    expect(state.people.every((person) => !("n" in person))).toBe(true);
    expect(state.people[0]).toMatchObject({ i: "PE" });
    expect(state.people[1]).toMatchObject({ a: picture(0) });
    expect(state.people[1]).not.toHaveProperty("i");
  });

  it("cuts long names", () => {
    const state = buildOverlayState([member(1, { name: "x".repeat(100) })], { names: true });
    expect([...state.people[0]!.n!]).toHaveLength(MAX_OVERLAY_NAME);
  });

  it("gives the same person the same colour", () => {
    const once = buildOverlayState([member(1)], { names: true }).people[0]!.c;
    expect(buildOverlayState([member(1)], { names: false }).people[0]!.c).toBe(once);
    expect(once).toBeGreaterThanOrEqual(0);
    expect(once).toBeLessThan(6);
  });

  it("stays under the size limit: pictures go from the bottom up, then rows", () => {
    const fits = buildOverlayState(crowd(8, (n) => ({ tiny: picture(n) })), { names: true });
    expect(stateBytes(fits)).toBeLessThanOrEqual(MAX_STATE_BYTES);
    expect(fits.people.every((person) => person.a)).toBe(true);

    // Pictures that are too big for all of them: the last rows lose theirs, the first keep them.
    const big = (n: number) => `data:image/webp;base64,${"A".repeat(3000 + n)}`;
    const squeezed = buildOverlayState(crowd(8, (n) => ({ tiny: big(n) })), { names: true });
    expect(stateBytes(squeezed)).toBeLessThanOrEqual(MAX_STATE_BYTES);
    expect(squeezed.people).toHaveLength(8);
    expect(squeezed.people[0]!.a).toBeDefined();
    expect(squeezed.people[7]!.a).toBeUndefined();
    expect(squeezed.people[7]!.i).toBe("PE");

    // One picture that is too big alone loses its picture, not the limit.
    const huge = buildOverlayState([member(1, { tiny: `data:image/webp;base64,${"A".repeat(20_000)}` })], { names: true });
    expect(stateBytes(huge)).toBeLessThanOrEqual(MAX_STATE_BYTES);
  });

  it("stays under the limit with the longest names and 99 people", () => {
    const state = buildOverlayState(crowd(99, (n) => ({ name: "é".repeat(100), tiny: picture(n), speaking: true, deafened: true })), { names: true });
    expect(stateBytes(state)).toBeLessThanOrEqual(MAX_STATE_BYTES);
    expect(state.people.length + state.more).toBe(99);
  });
});
