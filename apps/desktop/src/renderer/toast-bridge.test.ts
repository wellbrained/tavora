import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { dismissToast, toast, toasts, undoable } from "@tavora/official-ui/components/ui/toast";
import type { HostToast, ToastsEvent } from "../shared/host-toasts";
import { bridgeToasts, plainToast } from "./toast-bridge";
import { mirrorToasts } from "./toast-mirror";

// The host page keeps the toasts and what their buttons do; the toast page above the panels shows a copy and reports presses.
let sent: HostToast[][];
let events: (event: ToastsEvent) => void;
let stop: () => void;

beforeEach(() => {
  toasts.value = [];
  sent = [];
  stop = bridgeToasts({
    sync: (items) => sent.push(items),
    onEvent: (listener) => (events = listener),
  });
});
afterEach(() => {
  stop();
  toasts.value = [];
  mirrorToasts([], { action: () => undefined, dismiss: () => undefined });
});

describe("the host page's side", () => {
  it("sends a toast's words, never its functions", () => {
    toast({ title: "Layout deleted", action: { label: "Undo", onClick: () => undefined }, onDismiss: () => undefined, testid: "undo-toast", actionTestid: "undo" });
    const last = sent.at(-1)!;
    expect(last).toEqual([{ id: expect.any(Number), revision: 0, title: "Layout deleted", testid: "undo-toast", actionTestid: "undo", action: "Undo" }]);
    expect(() => structuredClone(last)).not.toThrow();
  });

  it("sends every change in order: a new toast, an update, a dismissal", () => {
    const handle = toast.loading("Saving");
    handle.update({ title: "Saved", variant: "success" });
    handle.dismiss();
    expect(sent.map((items) => items.map((item) => `${item.title}/${item.revision}`))).toEqual([[], ["Saving/0"], ["Saved/1"], []]);
  });

  it("keeps an endless toast endless over the wire", () => {
    toast.warning("Careful", { duration: Infinity });
    expect(structuredClone(sent.at(-1)![0]!.duration)).toBe(Infinity);
  });

  it("runs the button pressed on the toast page, and the toast goes", () => {
    const onClick = vi.fn();
    const { id } = toast({ title: "Note deleted", action: { label: "Undo", onClick } });
    events({ type: "action", id });
    expect(onClick).toHaveBeenCalledOnce();
    events({ type: "dismiss", id });
    expect(toasts.value).toHaveLength(0);
  });

  it("dismisses a toast the toast page closed and tells it it went", () => {
    const onDismiss = vi.fn();
    const { id } = toast({ title: "Bye", onDismiss });
    events({ type: "dismiss", id });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(sent.at(-1)).toEqual([]);
  });

  it("ignores a press on a toast that is gone", () => {
    const onClick = vi.fn();
    const handle = toast({ title: "x", action: { label: "Undo", onClick } });
    handle.dismiss();
    events({ type: "action", id: handle.id });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("gives Undo its undo once, and the delete stays final when the toast goes without it", async () => {
    const undo = vi.fn(() => true);
    const onFinal = vi.fn();
    const first = undoable({ title: "Layout deleted", undo, onFinal });
    const { id } = toasts.value.at(-1)!;
    events({ type: "action", id });
    events({ type: "dismiss", id });
    await nextTick();
    expect(await first.undo()).toBe(false);
    expect(undo).toHaveBeenCalledOnce();
    expect(onFinal).not.toHaveBeenCalled();

    const second = undoable({ title: "Frame removed", undo: () => true, onFinal });
    events({ type: "dismiss", id: toasts.value.at(-1)!.id });
    expect(onFinal).toHaveBeenCalledOnce();
    expect(second.state).toBe("final");
  });

  it("describes a toast without optional parts compactly", () => {
    expect(plainToast({ id: 4, revision: 2, title: "Hi" })).toEqual({ id: 4, revision: 2, title: "Hi" });
  });
});

describe("the toast page's side", () => {
  const presses = () => ({ action: vi.fn(), dismiss: vi.fn() });
  const item = (id: number, extra: Partial<HostToast> = {}): HostToast => ({ id, revision: 0, title: `Toast ${id}`, ...extra });

  it("shows what the host page sent in the kit's list", () => {
    mirrorToasts([item(1, { action: "Undo", variant: "success" }), item(2)], presses());
    expect(toasts.value.map((entry) => [entry.id, entry.title, entry.variant, entry.action?.label])).toEqual([
      [1, "Toast 1", "success", "Undo"],
      [2, "Toast 2", undefined, undefined],
    ]);
  });

  it("reports a press on the button, and a toast that went", () => {
    const report = presses();
    mirrorToasts([item(1, { action: "Undo" })], report);
    toasts.value[0]!.action!.onClick();
    expect(report.action).toHaveBeenCalledWith(1);
    dismissToast(1);
    expect(report.dismiss).toHaveBeenCalledWith(1);
    expect(toasts.value).toHaveLength(0);
  });

  it("does not bring back a toast that left while the host page was still being told", () => {
    const report = presses();
    mirrorToasts([item(1)], report);
    dismissToast(1);
    // A list sent before the host page heard about it.
    mirrorToasts([item(1), item(2)], report);
    expect(toasts.value.map((entry) => entry.id)).toEqual([2]);
    // Once the host page's list no longer has it, the id is free to forget.
    mirrorToasts([item(2)], report);
    expect(toasts.value.map((entry) => entry.id)).toEqual([2]);
  });

  it("does not report a toast the host page removed itself", () => {
    const report = presses();
    mirrorToasts([item(1)], report);
    mirrorToasts([], report);
    expect(report.dismiss).not.toHaveBeenCalled();
  });
});
