import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useListNav } from "./list-nav";

const key = (name: string) => {
  const event = { key: name, preventDefault: vi.fn() };
  return event as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
};

describe("useListNav", () => {
  it("moves with the arrows, wraps at the ends and runs Enter", async () => {
    const onEnter = vi.fn();
    const nav = useListNav({ count: () => 3, list: ref(null), onEnter });
    const down = key("ArrowDown");
    nav.onKey(down);
    expect(nav.active.value).toBe(1);
    expect(down.preventDefault).toHaveBeenCalled();
    nav.onKey(key("ArrowUp"));
    nav.onKey(key("ArrowUp"));
    expect(nav.active.value).toBe(2);
    nav.onKey(key("ArrowDown"));
    expect(nav.active.value).toBe(0);
    nav.onKey(key("Enter"));
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("stays put on an empty list and leaves other keys alone", () => {
    const nav = useListNav({ count: () => 0, list: ref(null), onEnter: () => {} });
    nav.onKey(key("ArrowDown"));
    expect(nav.active.value).toBe(0);
    const other = key("a");
    nav.onKey(other);
    expect(other.preventDefault).not.toHaveBeenCalled();
  });

  it("scrolls the selected row into view", async () => {
    const scrollIntoView = vi.fn();
    const list = ref({ querySelector: () => ({ scrollIntoView }) } as unknown as HTMLElement);
    const nav = useListNav({ count: () => 2, list, onEnter: () => {} });
    await nav.move(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
