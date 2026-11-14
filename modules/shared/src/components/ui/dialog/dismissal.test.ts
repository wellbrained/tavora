// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import Dialog from "./Dialog.vue";
import DialogContent from "./DialogContent.vue";
import DialogFooter from "./DialogFooter.vue";
import DialogHeader from "./DialogHeader.vue";
import DialogScrollContent from "./DialogScrollContent.vue";
import { dismissVerdict, isSecondaryPress, type DismissAttempt } from "./dismissal";

// Who may close a kit dialog: Escape, a press outside and the close X close it, unless it is not `dismissible` (each try
// is then told to the page) or `busy` (refused without a word).

describe("dismissVerdict", () => {
  it("closes by default", () => {
    expect(dismissVerdict({})).toBe("close");
    expect(dismissVerdict({ dismissible: true, busy: false })).toBe("close");
  });

  it("leaves it to the page when the dialog is not dismissible", () => {
    expect(dismissVerdict({ dismissible: false })).toBe("attempt");
  });

  it("refuses without a word while busy, dismissible or not", () => {
    expect(dismissVerdict({ busy: true })).toBe("refuse");
    expect(dismissVerdict({ busy: true, dismissible: false })).toBe("refuse");
  });
});

describe("isSecondaryPress", () => {
  const press = (init: PointerEventInit) => new MouseEvent("pointerdown", init) as PointerEvent;
  it("is a right-click or Ctrl with the left button", () => {
    expect(isSecondaryPress(press({ button: 2 }))).toBe(true);
    expect(isSecondaryPress(press({ button: 0, ctrlKey: true }))).toBe(true);
    expect(isSecondaryPress(press({ button: 0 }))).toBe(false);
  });
});

describe.each([
  ["DialogContent", DialogContent],
  ["DialogScrollContent", DialogScrollContent],
])("the kit's %s", (_name, Content) => {
  let app: App | undefined;
  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = "";
  });

  async function mount(content: Record<string, unknown> = {}, footer = false) {
    const open = ref(true);
    const attempts: DismissAttempt[] = [];
    const root = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(root, outside);
    app = createApp(
      defineComponent({
        render: () =>
          h(Dialog, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value) }, () =>
            h(Content, { onDismissAttempt: (attempt: DismissAttempt) => attempts.push(attempt), ...content }, () => [
              h("p", "Hi"),
              footer ? h(DialogFooter, { showCloseButton: true }) : null,
            ]),
          ),
      }),
    );
    app.mount(root);
    await settle();
    const close = () => document.body.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
    return { open, attempts, close, outside };
  }

  /** Lets Reka's layer start listening (it waits a tick before it hears presses outside). */
  const settle = async () => {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  };
  const escape = () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  const pressOn = (target: Element, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, ...init }));

  it("closes with Escape, a press outside and the X by default, and tells the page nothing", async () => {
    const dialog = await mount();
    escape();
    await settle();
    expect(dialog.open.value).toBe(false);

    dialog.open.value = true;
    await settle();
    pressOn(dialog.outside);
    await settle();
    expect(dialog.open.value).toBe(false);

    dialog.open.value = true;
    await settle();
    dialog.close()!.click();
    await settle();
    expect(dialog.open.value).toBe(false);
    expect(dialog.attempts).toEqual([]);
  });

  it("stays open when it is not dismissible, and tells the page each try with its reason", async () => {
    const dialog = await mount({ dismissible: false });
    escape();
    pressOn(dialog.outside);
    dialog.close()!.click();
    await settle();
    expect(dialog.open.value).toBe(true);
    expect(dialog.attempts.map((attempt) => attempt.reason)).toEqual(["escape", "outside", "close-button"]);
  });

  it("stays open while busy, says nothing, and turns the X off", async () => {
    const dialog = await mount({ busy: true, dismissible: false });
    escape();
    pressOn(dialog.outside);
    await settle();
    expect(dialog.open.value).toBe(true);
    expect(dialog.attempts).toEqual([]);
    expect(dialog.close()!.disabled).toBe(true);
  });

  it("does not count a right-click outside as a try", async () => {
    const dialog = await mount({ dismissible: false });
    pressOn(dialog.outside, { button: 2 });
    await settle();
    expect(dialog.open.value).toBe(true);
    expect(dialog.attempts).toEqual([]);
  });

  it("leaves an Escape that the page took first alone", async () => {
    const dialog = await mount({ dismissible: false, onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault() });
    escape();
    await settle();
    expect(dialog.open.value).toBe(true);
    expect(dialog.attempts).toEqual([]);
  });

  it("keeps the kit's props off the element", async () => {
    await mount({ dismissible: false, busy: false });
    const content = document.body.querySelector('[role="dialog"]')!;
    expect(content.hasAttribute("dismissible")).toBe(false);
    expect(content.hasAttribute("busy")).toBe(false);
  });
});

describe("the footer's Close and the header's X", () => {
  let app: App | undefined;
  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = "";
  });

  function mount(content: Record<string, unknown>) {
    const open = ref(true);
    const attempts: DismissAttempt[] = [];
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(
      defineComponent({
        render: () =>
          h(Dialog, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value) }, () =>
            h(DialogContent, { onDismissAttempt: (attempt: DismissAttempt) => attempts.push(attempt), ...content }, () => [
              h(DialogHeader, { title: "Rename" }),
              h(DialogFooter, { showCloseButton: true }),
            ]),
          ),
      }),
    );
    app.mount(root);
    const buttons = () => [...document.body.querySelectorAll<HTMLButtonElement>("button")];
    return { open, attempts, buttons };
  }

  it("follow the dialog's rules", async () => {
    const dialog = mount({ dismissible: false });
    await nextTick();
    const [x, close] = dialog.buttons();
    x!.click();
    close!.click();
    await nextTick();
    expect(dialog.open.value).toBe(true);
    expect(dialog.attempts.map((attempt) => attempt.reason)).toEqual(["close-button", "close-button"]);
  });

  it("are off while busy", async () => {
    const dialog = mount({ busy: true });
    await nextTick();
    expect(dialog.buttons().every((button) => button.disabled)).toBe(true);
  });

  it("close a dialog that may be closed", async () => {
    const dialog = mount({});
    await nextTick();
    dialog.buttons()[1]!.click();
    await nextTick();
    expect(dialog.open.value).toBe(false);
  });
});
