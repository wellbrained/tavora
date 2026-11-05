// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import { Dialog, DialogContent, DialogScrollContent } from "../dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { toasts } from "./toast";
import { handleUndoKey, openUndos, undoable } from "./undoable";

// Ctrl+Z takes back a delete, but not behind a dialog: while one is open the page behind it is not the user's focus,
// and a row coming back under a "Delete this?" question is a surprise. Real events, real kit dialogs.

describe("Ctrl+Z behind an open dialog", () => {
  let app: App | undefined;
  let used: boolean[];
  const onKey = (event: KeyboardEvent) => used.push(handleUndoKey(event));

  beforeEach(() => {
    // jsdom has no animations; a dialog opened over another one asks its parent for them.
    Element.prototype.getAnimations ??= () => [];
    toasts.value = [];
    used = [];
    document.addEventListener("keydown", onKey);
  });
  afterEach(() => {
    document.removeEventListener("keydown", onKey);
    app?.unmount();
    app = undefined;
    document.body.innerHTML = "";
    for (const offer of [...openUndos()]) offer.drop();
  });

  /** A kit dialog with a button and a text field in it. `scroll` uses the scrolling variant. */
  function mount(options: { open?: boolean; scroll?: boolean } = {}) {
    const open = ref(options.open ?? false);
    const root = document.createElement("div");
    document.body.append(root);
    const Content = options.scroll ? DialogScrollContent : DialogContent;
    app = createApp(
      defineComponent({
        render: () =>
          h(Dialog, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value) }, () =>
            h(Content, null, () => [h("button", { id: "inside" }, "Cancel"), h("input", { id: "field" })]),
          ),
      }),
    );
    app.mount(root);
    return open;
  }

  const ctrlZ = (target: Element | Document) => {
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const settle = async () => {
    for (let i = 0; i < 3; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  for (const scroll of [false, true]) {
    const kind = scroll ? "scrolling dialog" : "dialog";

    it(`does not undo the delete while a ${kind} is open (key on a button in it, or on the page)`, async () => {
      const undo = vi.fn();
      undoable({ title: "Row deleted", undo });
      const open = mount({ scroll });
      open.value = true;
      await settle();
      expect(document.getElementById("inside")).not.toBeNull();

      const inside = ctrlZ(document.getElementById("inside")!);
      const onPage = ctrlZ(document.body);
      expect(used).toEqual([false, false]);
      expect(inside.defaultPrevented).toBe(false);
      expect(onPage.defaultPrevented).toBe(false);
      await settle();
      expect(undo).not.toHaveBeenCalled();
      expect(openUndos()).toHaveLength(1);
    });

    it(`undoes it again once the ${kind} is closed`, async () => {
      const undo = vi.fn();
      undoable({ title: "Row deleted", undo });
      const open = mount({ scroll });
      open.value = true;
      await settle();
      ctrlZ(document.body);
      expect(undo).not.toHaveBeenCalled();

      open.value = false;
      await settle();
      const event = ctrlZ(document.body);
      expect(used.at(-1)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      await settle();
      expect(undo).toHaveBeenCalledTimes(1);
    });
  }

  it("works while a dialog that was open is taken away with the page (unmounted)", async () => {
    const undo = vi.fn();
    undoable({ title: "Row deleted", undo });
    const open = mount();
    open.value = true;
    await settle();
    app?.unmount();
    app = undefined;
    ctrlZ(document.body);
    await settle();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("counts every open dialog: one closed, the other still blocks", async () => {
    const undo = vi.fn();
    undoable({ title: "Row deleted", undo });
    const first = ref(true);
    const second = ref(true);
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(
      defineComponent({
        render: () => [
          h(Dialog, { open: first.value }, () => h(DialogContent, null, () => h("p", "One"))),
          h(Dialog, { open: second.value }, () => h(DialogContent, null, () => h("p", "Two"))),
        ],
      }),
    );
    app.mount(root);
    await settle();
    first.value = false;
    await settle();
    ctrlZ(document.body);
    expect(undo).not.toHaveBeenCalled();
    second.value = false;
    await settle();
    ctrlZ(document.body);
    await settle();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("leaves the native undo of a field inside the dialog alone", async () => {
    const undo = vi.fn();
    undoable({ title: "Row deleted", undo });
    const open = mount({ open: true });
    await settle();
    const event = ctrlZ(document.getElementById("field")!);
    expect(used).toEqual([false]);
    // Not prevented: the browser still undoes the typing.
    expect(event.defaultPrevented).toBe(false);
    await settle();
    expect(undo).not.toHaveBeenCalled();
    // Closed again, the same field in the page keeps its own undo too (the field is gone with the dialog; use another).
    open.value = false;
    await settle();
    const field = document.createElement("input");
    document.body.append(field);
    expect(ctrlZ(field).defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it("a text field outside any dialog keeps its own undo too", () => {
    const undo = vi.fn();
    undoable({ title: "Row deleted", undo });
    const field = document.createElement("input");
    document.body.append(field);
    expect(ctrlZ(field).defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it("stands down for a key pressed inside a menu, list or popover that is open", async () => {
    const undo = vi.fn();
    undoable({ title: "Row deleted", undo });
    for (const role of ["menu", "listbox", "dialog", "alertdialog"]) {
      const popup = document.createElement("div");
      popup.setAttribute("role", role);
      const item = document.createElement("button");
      popup.append(item);
      document.body.append(popup);
      expect(ctrlZ(item).defaultPrevented).toBe(false);
    }
    await settle();
    expect(undo).not.toHaveBeenCalled();
  });

  it("a popover left open, with the focus back on the page, does not take the key", async () => {
    const undo = vi.fn();
    undoable({ title: "Row deleted", undo });
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(
      defineComponent({
        render: () => h(Popover, { open: true }, () => [h(PopoverTrigger, null, () => "Open"), h(PopoverContent, null, () => h("p", "Hi"))]),
      }),
    );
    app.mount(root);
    await settle();
    ctrlZ(document.body);
    await settle();
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
