import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
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

describe("useListNav keys", () => {
  const press = (name: string, extra: Partial<KeyboardEvent> = {}) =>
    Object.assign(key(name), { ctrlKey: false, metaKey: false, isComposing: false, ...extra }) as KeyboardEvent & {
      preventDefault: ReturnType<typeof vi.fn>;
    };

  it("jumps ten rows with Page Down and Up without wrapping", () => {
    const nav = useListNav({ count: () => 15, list: ref(null), onEnter: () => {} });
    nav.onKey(press("PageDown"));
    expect(nav.active.value).toBe(10);
    nav.onKey(press("PageDown"));
    expect(nav.active.value).toBe(14);
    nav.onKey(press("PageUp"));
    expect(nav.active.value).toBe(4);
    nav.onKey(press("PageUp"));
    expect(nav.active.value).toBe(0);
  });

  it("goes to the first and last row with Ctrl+Home and Ctrl+End, and leaves plain Home and End to the caret", () => {
    const nav = useListNav({ count: () => 5, list: ref(null), onEnter: () => {} });
    nav.onKey(press("End", { ctrlKey: true }));
    expect(nav.active.value).toBe(4);
    nav.onKey(press("Home", { ctrlKey: true }));
    expect(nav.active.value).toBe(0);
    const plain = press("End");
    nav.onKey(plain);
    expect(nav.active.value).toBe(0);
    expect(plain.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves Enter and the arrows alone while an input method composes", () => {
    const onEnter = vi.fn();
    const nav = useListNav({ count: () => 3, list: ref(null), onEnter });
    nav.onKey(press("Enter", { isComposing: true }));
    nav.onKey(press("ArrowDown", { isComposing: true }));
    expect(onEnter).not.toHaveBeenCalled();
    expect(nav.active.value).toBe(0);
  });

  it("keeps the highlight on the same row when rows arrive, and goes to the top when the text changes", async () => {
    const rows = ref(["a", "b", "c"]);
    const text = ref("x");
    const nav = useListNav({ count: () => rows.value.length, list: ref(null), onEnter: () => {}, track: { keys: () => rows.value, resetOn: () => text.value } });
    nav.active.value = 1;
    rows.value = ["new", "a", "b", "c"];
    await nextTick();
    expect(nav.active.value).toBe(2);
    rows.value = ["a"];
    await nextTick();
    expect(nav.active.value).toBe(0);
    rows.value = ["a", "b"];
    nav.active.value = 1;
    await nextTick();
    text.value = "xy";
    rows.value = ["c", "b"];
    await nextTick();
    expect(nav.active.value).toBe(0);
  });

  it("moves the highlight only when the pointer really moves", () => {
    const nav = useListNav({ count: () => 3, list: ref(null), onEnter: () => {} });
    const at = (x: number, y: number) => ({ clientX: x, clientY: y }) as MouseEvent;
    nav.onHover(2, at(10, 10));
    expect(nav.active.value).toBe(0);
    nav.onHover(2, at(10, 12));
    expect(nav.active.value).toBe(2);
    nav.onKey(press("ArrowUp"));
    nav.onHover(2, at(10, 12));
    expect(nav.active.value).toBe(1);
    // Opened again, or back from outside the list: the first event only notes the new place.
    nav.resetHover();
    nav.onHover(0, at(50, 80));
    expect(nav.active.value).toBe(1);
  });

  it("leaves Ctrl+Shift+Home and End to select text in the field", () => {
    const nav = useListNav({ count: () => 5, list: ref(null), onEnter: () => {} });
    const select = press("End", { ctrlKey: true, shiftKey: true });
    nav.onKey(select);
    expect(nav.active.value).toBe(0);
    expect(select.preventDefault).not.toHaveBeenCalled();
  });
});
