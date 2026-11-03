// The stacking order of the frames in a setup (Arrange in a frame's menu). A setup keeps it as a number on each frame
// (`z`, 0 at the back); a frame that never got one sits above those that did, in the order they were added.

export type ArrangeTo = "front" | "forward" | "backward" | "back";

export const ARRANGE_TO: readonly ArrangeTo[] = ["front", "forward", "backward", "back"];

export const isArrangeTo = (value: unknown): value is ArrangeTo => typeof value === "string" && (ARRANGE_TO as readonly string[]).includes(value);

/**
 * `order` (back to front) with the frames `ids` moved: to the very front or back, or one step past the next frame that isn't
 * moving. Frames that move together keep their order to each other.
 */
export function arrange(order: readonly string[], ids: readonly string[], to: ArrangeTo): string[] {
  const moving = new Set(ids);
  const next = [...order];
  if (to === "front") return [...next.filter((id) => !moving.has(id)), ...next.filter((id) => moving.has(id))];
  if (to === "back") return [...next.filter((id) => moving.has(id)), ...next.filter((id) => !moving.has(id))];
  if (to === "forward") {
    for (let index = next.length - 2; index >= 0; index--) {
      if (moving.has(next[index]!) && !moving.has(next[index + 1]!)) [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
    }
  } else {
    for (let index = 1; index < next.length; index++) {
      if (moving.has(next[index]!) && !moving.has(next[index - 1]!)) [next[index], next[index - 1]] = [next[index - 1]!, next[index]!];
    }
  }
  return next;
}

/** The frames back to front: by their `z`, a frame without one above the others, ties by the order given. */
export function stackOrder<T extends { id: string; z: number | null }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.z ?? Number.MAX_SAFE_INTEGER) - (b.item.z ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ item }) => item);
}
