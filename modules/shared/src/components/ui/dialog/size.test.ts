// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import Dialog from "./Dialog.vue";
import DialogContent from "./DialogContent.vue";
import DialogScrollContent from "./DialogScrollContent.vue";
import { DIALOG_WIDTHS, dialogAnchorClass, dialogSizeClass, type DialogSize } from "./size";

// A dialog is one of four widths (M is the default) and sits in the middle or near the top; callers never set a width.

describe("dialog sizes", () => {
  it("has four steps that grow, and M is the 420 every dialog had", () => {
    expect(DIALOG_WIDTHS).toEqual({ sm: 360, md: 420, lg: 560, xl: 760 });
  });

  it("writes each step as a width that never passes the window", () => {
    for (const [size, width] of Object.entries(DIALOG_WIDTHS)) expect(dialogSizeClass[size as DialogSize]).toBe(`max-w-[min(${width}px,calc(100%-2rem))]`);
  });

  it("top sits at 12vh and keeps the dialog inside the window; center adds nothing", () => {
    expect(dialogAnchorClass.center).toBe("");
    expect(dialogAnchorClass.top).toContain("top-[12vh]");
    expect(dialogAnchorClass.top).toContain("translate-y-0");
    expect(dialogAnchorClass.top).toContain("max-h-[calc(100%-12vh-1rem)]");
  });
});

describe("the kit's dialogs take size and anchor", () => {
  let app: App | undefined;
  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = "";
  });

  async function mount(component: typeof DialogContent | typeof DialogScrollContent, props: Record<string, unknown> = {}) {
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(defineComponent({ render: () => h(Dialog, { open: ref(true).value }, () => h(component as never, { ...props }, () => h("p", "Hi"))) }));
    app.mount(root);
    await nextTick();
    return document.body.querySelector<HTMLElement>(".tavora-dialog")!;
  }

  it("DialogContent is M and centred when nothing is asked", async () => {
    const el = await mount(DialogContent);
    expect(el.className).toContain(dialogSizeClass.md);
    expect(el.className).not.toContain("top-[12vh]");
    expect(el.className).toContain("top-[50%]");
  });

  it("DialogContent takes each size, and the caller's class still wins", async () => {
    for (const size of ["sm", "lg", "xl"] as const) {
      const el = await mount(DialogContent, { size });
      expect(el.className).toContain(dialogSizeClass[size]);
      expect(el.className).not.toContain(dialogSizeClass.md);
      app?.unmount();
      document.body.innerHTML = "";
    }
    const own = await mount(DialogContent, { size: "lg", class: "max-w-none" });
    expect(own.className).toContain("max-w-none");
    expect(own.className).not.toContain(dialogSizeClass.lg);
  });

  it("anchor top replaces the centring", async () => {
    const el = await mount(DialogContent, { anchor: "top" });
    expect(el.className).toContain("top-[12vh]");
    expect(el.className).not.toContain("top-[50%]");
    expect(el.className).not.toContain("translate-y-[-50%]");
  });

  it("DialogScrollContent is M by default and takes a size", async () => {
    const plain = await mount(DialogScrollContent);
    expect(plain.className).toContain(dialogSizeClass.md);
    app?.unmount();
    document.body.innerHTML = "";
    const xl = await mount(DialogScrollContent, { size: "xl" });
    expect(xl.className).toContain(dialogSizeClass.xl);
  });
});
