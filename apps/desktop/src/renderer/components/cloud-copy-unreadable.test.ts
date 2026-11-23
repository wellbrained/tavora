// @vitest-environment jsdom
// The question when the newest cloud copy in the folder doesn't open with this PC's key (#909): it may be another PC's that
// started over with a key of its own; signed out that key can be typed in, signed in it isn't asked for. Keeping
// this PC's data over it is asked once more first. The host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";
import type { AccountView, CloudCopyView } from "../../shared/host-api";

const host = vi.hoisted(() => ({ act: vi.fn() }));
vi.mock("../host", async () => {
  const { shallowRef, ref } = await import("vue");
  return { ...host, account: shallowRef(null), cloudCopy: shallowRef(null), copyQuestion: ref(null), copyLater: ref(null) };
});
// The dialog's frame, without the real overlay: its title and text, then what goes in it.
vi.mock("./ModalDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { title: String, description: String },
      setup: (props, { slots }) => () => h("div", [h("h2", { "data-testid": "title" }, props.title), h("p", { "data-testid": "text" }, props.description), slots.default?.()]),
    }),
  };
});

import { account, cloudCopy, copyQuestion } from "../host";
import { t } from "../i18n";
import CloudCopyDialog from "./CloudCopyDialog.vue";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  host.act.mockReset();
  host.act.mockResolvedValue({ ok: true });
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});
const $ = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function ask(signedIn: boolean) {
  (account as { value: AccountView | null }).value = (signedIn ? { account: { email: "me@example.com" } } : { account: null }) as unknown as AccountView;
  (cloudCopy as { value: CloudCopyView | null }).value = { on: true, folder: "C:/Users/me/OneDrive", conflict: true, conflictKind: "unreadable" } as unknown as CloudCopyView;
  (copyQuestion as { value: string | null }).value = "conflict";
  app = createApp(defineComponent({ render: () => h(CloudCopyDialog) }));
  app.mount(root);
  await tick();
}

describe("the question when the newest cloud copy won't open", () => {
  it("signed out: says another PC may have started over, and takes its key", async () => {
    await ask(false);
    expect($("text")!.textContent).toBe(t("cloudCopy.unreadable.text"));
    expect($("cloud-copy-keep-cloud")).toBeNull();
    const input = $("cloud-copy-other-key-input") as HTMLInputElement;
    input.value = "ABCD-EFGH";
    input.dispatchEvent(new Event("input"));
    await tick();
    $("cloud-copy-other-key-submit")!.click();
    await tick();
    expect(host.act).toHaveBeenCalledWith({ type: "cloud-copy-other-key", key: "ABCD-EFGH" });
  });

  it("signed in: asks for no key, and still says another PC may have started over", async () => {
    await ask(true);
    expect($("text")!.textContent).toBe(t("cloudCopy.unreadable.textOwnKey"));
    expect($("text")!.textContent).toContain("started over");
    expect($("cloud-copy-other-key-input")).toBeNull();
    $("cloud-copy-keep-pc")!.click();
    await tick();
    expect($("text")!.textContent).toBe(t("cloudCopy.replace.text"));
  });

  it("asks once more before this PC's data replaces it, and Back goes back", async () => {
    await ask(false);
    $("cloud-copy-keep-pc")!.click();
    await tick();
    expect(host.act).not.toHaveBeenCalled();
    expect($("title")!.textContent).toBe(t("cloudCopy.replace.title"));
    expect($("text")!.textContent).toBe(t("cloudCopy.replace.text"));
    expect($("cloud-copy-other-key-input")).toBeNull();
    $("cloud-copy-replace-back")!.click();
    await tick();
    expect($("title")!.textContent).toBe(t("cloudCopy.unreadable.title"));
    $("cloud-copy-keep-pc")!.click();
    await tick();
    $("cloud-copy-replace")!.click();
    await tick();
    expect(host.act).toHaveBeenCalledWith({ type: "cloud-copy-keep", side: "pc", replace: true });
  });
});
