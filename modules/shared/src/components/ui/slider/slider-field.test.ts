// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import { SliderField } from ".";
import { commitTyped, parseTyped, snapToStep } from "./slider-field";

describe("typed numbers", () => {
  it("reads whole, decimal and comma numbers, and nothing else", () => {
    expect(parseTyped("42")).toBe(42);
    expect(parseTyped(" -7 ")).toBe(-7);
    expect(parseTyped("2.5")).toBe(2.5);
    expect(parseTyped("2,5")).toBe(2.5);
    expect(parseTyped(".5")).toBe(0.5);
    for (const text of ["", " ", "abc", "5 %", "1e2", "0x10", "--1", "1.2.3"]) expect(parseTyped(text)).toBeNull();
  });

  it("snaps onto the step grid that starts at min", () => {
    expect(snapToStep(72, 0, 100, 5)).toBe(70);
    expect(snapToStep(73, 0, 100, 5)).toBe(75);
    expect(snapToStep(13, 3, 100, 5)).toBe(13); // 3, 8, 13, 18 …
    expect(snapToStep(14, 3, 100, 5)).toBe(13);
    expect(snapToStep(0.3, 0, 1, 0.1)).toBe(0.3); // no 0.30000000000000004
    expect(snapToStep(1.126, 0, 5, 0.25)).toBe(1.25);
  });

  it("clamps to min and max", () => {
    expect(snapToStep(250, 0, 100, 5)).toBe(100);
    expect(snapToStep(-30, 0, 100, 5)).toBe(0);
    expect(snapToStep(103, 0, 98, 5)).toBe(98); // max is off the grid: the limit still wins
  });

  it("commits only real numbers", () => {
    expect(commitTyped("73", 0, 100, 5)).toBe(75);
    expect(commitTyped("500", 0, 100, 5)).toBe(100);
    expect(commitTyped("oops", 0, 100, 5)).toBeNull();
  });
});

// jsdom has no ResizeObserver, which the slider thumb measures itself with.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});

function mount(initial: number, props: Record<string, unknown> = {}) {
  const value = ref(initial);
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(
    defineComponent({
      render: () => h(SliderField, { modelValue: value.value, "onUpdate:modelValue": (next: number) => (value.value = next), min: 0, max: 100, step: 5, unit: "%", label: "Opacity", ...props }),
    }),
  );
  app.mount(root);
  const box = () => root.querySelector<HTMLInputElement>("[data-slot=slider-input]");
  const reset = () => root.querySelector<HTMLElement>("[data-slot=slider-reset]");
  const thumb = () => root.querySelector<HTMLElement>("[data-slot=slider-thumb]")!;
  const type = async (text: string) => {
    const input = box()!;
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
  };
  const key = async (target: HTMLElement, name: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    await nextTick();
    return event;
  };
  return { value, root, box, reset, thumb, type, key };
}

describe("SliderField as it was", () => {
  it("shows the value and unit read-only, with no box and no Reset", () => {
    const { root, box, reset } = mount(70);
    expect(root.querySelector("output")!.textContent).toBe("70 %");
    expect(box()).toBeNull();
    expect(reset()).toBeNull();
    expect(root.firstElementChild!.className).not.toContain("flex-wrap");
  });
});

describe("SliderField editable", () => {
  it("shows the number in a box and the unit beside it", () => {
    const { root, box } = mount(70, { editable: true });
    expect(box()!.value).toBe("70");
    expect(root.querySelector("output")).toBeNull();
    expect(root.querySelector("[data-slot=slider-unit]")!.textContent).toBe("%");
    expect(box()!.className).toContain("text-right");
    expect(box()!.className).toContain("tabular-nums");
  });

  it("takes a typed number only when you leave the box, snapped onto the step", async () => {
    const { value, box, type } = mount(70, { editable: true });
    await type("73");
    expect(value.value).toBe(70);
    box()!.dispatchEvent(new Event("blur"));
    await nextTick();
    expect(value.value).toBe(75);
    expect(box()!.value).toBe("75");
  });

  it("takes it on Enter too", async () => {
    const { value, box, type, key } = mount(70, { editable: true });
    await type("40");
    const event = await key(box()!, "Enter");
    expect(value.value).toBe(40);
    expect(event.defaultPrevented).toBe(true);
  });

  it("clamps to min and max", async () => {
    const { value, box, type, key } = mount(70, { editable: true });
    await type("900");
    await key(box()!, "Enter");
    expect(value.value).toBe(100);
    expect(box()!.value).toBe("100");
    await type("-20");
    await key(box()!, "Enter");
    expect(value.value).toBe(0);
    expect(box()!.value).toBe("0");
  });

  it("puts the old number back on Escape, and keeps the key", async () => {
    const { value, box, type, key } = mount(70, { editable: true });
    await type("15");
    const event = await key(box()!, "Escape");
    expect(box()!.value).toBe("70");
    expect(value.value).toBe(70);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Escape to the dialog around it when there is nothing to put back", async () => {
    const { box, key } = mount(70, { editable: true });
    const event = await key(box()!, "Escape");
    expect(event.defaultPrevented).toBe(false);
  });

  it("goes back to the number when the text is not one", async () => {
    const { value, box, type, key } = mount(70, { editable: true });
    await type("lots");
    await key(box()!, "Enter");
    expect(value.value).toBe(70);
    expect(box()!.value).toBe("70");
  });

  it("shows the true number again when typing lands on the same step", async () => {
    const { value, box, type } = mount(70, { editable: true });
    await type("71");
    box()!.dispatchEvent(new Event("blur"));
    await nextTick();
    expect(value.value).toBe(70);
    expect(box()!.value).toBe("70");
  });

  it("follows the slider", async () => {
    const { box, thumb, key } = mount(70, { editable: true });
    await key(thumb(), "ArrowRight");
    expect(box()!.value).toBe("75");
  });

  it("accepts a comma as the decimal mark", async () => {
    const { value, box, type, key } = mount(1, { editable: true, min: 0, max: 5, step: 0.5, unit: "s" });
    await type("2,5");
    await key(box()!, "Enter");
    expect(value.value).toBe(2.5);
  });
});

describe("SliderField reset", () => {
  it("shows Reset only while the value differs, and keeps its room when it is hidden", async () => {
    const { value, reset } = mount(50, { resetValue: 50 });
    expect(reset()!.className).toContain("invisible");
    value.value = 80;
    await nextTick();
    expect(reset()!.className).not.toContain("invisible");
    value.value = 50;
    await nextTick();
    expect(reset()!.className).toContain("invisible");
    expect(reset()).not.toBeNull();
  });

  it("sets the value back, hides itself and hands the focus to the slider", async () => {
    const { value, reset, thumb } = mount(80, { resetValue: 50, editable: true });
    reset()!.click();
    await nextTick();
    await nextTick();
    expect(value.value).toBe(50);
    expect(reset()!.className).toContain("invisible");
    expect(document.activeElement).toBe(thumb());
  });

  it("shows the reset text it is given", () => {
    const { reset } = mount(80, { resetValue: 50, resetLabel: "Zurücksetzen" });
    expect(reset()!.textContent!.trim()).toBe("Zurücksetzen");
  });

  it("also shows when the value is typed away from it", async () => {
    const { box, reset, type, key } = mount(50, { resetValue: 50, editable: true });
    await type("65");
    await key(box()!, "Enter");
    expect(reset()!.className).not.toContain("invisible");
  });

  it("wraps instead of squeezing", () => {
    const { root } = mount(50, { resetValue: 50 });
    expect(root.firstElementChild!.className).toContain("flex-wrap");
  });
});

describe("SliderField keys", () => {
  it("moves by one step on an arrow", async () => {
    const { value, thumb, key } = mount(50);
    await key(thumb(), "ArrowRight");
    expect(value.value).toBe(55);
    await key(thumb(), "ArrowLeft");
    await key(thumb(), "ArrowLeft");
    expect(value.value).toBe(45);
  });

  it("moves by ten steps on Shift+arrow, Page Up and Page Down", async () => {
    const { value, thumb, key } = mount(20, { max: 1000 });
    await key(thumb(), "ArrowRight", { shiftKey: true });
    expect(value.value).toBe(70);
    await key(thumb(), "PageUp");
    expect(value.value).toBe(120);
    await key(thumb(), "ArrowLeft", { shiftKey: true });
    expect(value.value).toBe(70);
    await key(thumb(), "PageDown");
    expect(value.value).toBe(20);
  });

  it("keeps a big step between min and max", async () => {
    const { value, thumb, key } = mount(90);
    await key(thumb(), "ArrowRight", { shiftKey: true });
    expect(value.value).toBe(100);
    await key(thumb(), "PageDown");
    await key(thumb(), "PageDown");
    await key(thumb(), "PageDown");
    expect(value.value).toBe(0);
  });
});
