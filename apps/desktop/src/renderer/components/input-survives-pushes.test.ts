// @vitest-environment jsdom
// Bug hunt B (2026-11-24): the main process sends fresh copies of host objects (state after every action, account and
// inbox views on their own changes). A watcher that compares them by identity resets what the user is typing, so these
// forms watch the content instead. The host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, shallowRef, type App } from "vue";
import type { AccountView } from "../../shared/host-api";

const host = vi.hoisted(() => ({ act: vi.fn(), notSaved: vi.fn(), confirmAction: vi.fn(), submitAction: vi.fn(), prompt: vi.fn() }));
vi.mock("../host", async () => {
  const { shallowRef } = await import("vue");
  return { ...host, account: shallowRef(null), inbox: shallowRef({ items: [] }), inboxOpen: shallowRef(null) };
});
// Plain dialog frame and parts this test is not about.
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const plain = (tag = "div") => defineComponent({ inheritAttrs: false, setup: (_, { slots, attrs }) => () => h(tag, attrs, slots.default?.()) });
  return { Dialog: plain(), DialogContent: plain(), DialogTitle: plain(), DialogDescription: plain() };
});
vi.mock("./messages/ConversationView.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { id: String }, setup: (props) => () => h("div", { "data-testid": "view" }, props.id) }) };
});
vi.mock("./messages/ContactDeveloperDialog.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./messages/NoteText.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./settings/RecoveryKeySettings.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./settings/SettingRow.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { label: String, description: String }, setup: (props, { slots }) => () => h("div", [props.label, props.description, slots.default?.()]) }) };
});

import { account, inbox, inboxOpen } from "../host";
import ContactChoice from "./developer/ContactChoice.vue";
import AccountSection from "./settings/AccountSection.vue";
import SignInForm from "./settings/SignInForm.vue";
import InboxDialog from "./messages/InboxDialog.vue";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  await tick();
  await tick();
};

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
const type = async (id: string, value: string) => {
  const input = $(id) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
};
const set = <T>(ref: unknown, value: T) => ((ref as { value: T }).value = value);

describe("InboxDialog", () => {
  it("switches to a conversation opened while it is showing", async () => {
    set(inbox, { items: [{ id: "old", unread: false }, { id: "new", unread: false }] });
    set(inboxOpen, { id: "old" });
    app = createApp(defineComponent({ render: () => h(InboxDialog) }));
    app.mount(root);
    await settle();
    expect($("view")!.textContent).toBe("old");
    set(inboxOpen, { id: "new" });
    await settle();
    expect($("view")!.textContent).toBe("new");
  });
});

describe("ContactChoice", () => {
  const mountChoice = async (contact: { kind: string; value: string | null }) => {
    const current = shallowRef(contact);
    app = createApp(defineComponent({ render: () => h(ContactChoice, { contact: current.value as never, name: "Notes", save: async () => null, testid: "cc" }) }));
    app.mount(root);
    await settle();
    return current;
  };
  it("keeps a half-typed address when the same contact arrives again", async () => {
    const current = await mountChoice({ kind: "email", value: "old@example.com" });
    await type("cc-value", "new@exam");
    current.value = { kind: "email", value: "old@example.com" };
    await settle();
    expect(($("cc-value") as HTMLInputElement).value).toBe("new@exam");
  });
});

describe("sign-in codes", () => {
  const view = (pending: unknown) => ({ enabled: true, canKeepSignIn: true, discordLogin: false, account: null, devices: [], pending }) as unknown as AccountView;
  it("keeps the code being typed when the same step is sent again", async () => {
    set(account, view({ kind: "sign-in", email: "a@b.c", step: "code" }));
    app = createApp(defineComponent({ render: () => h(SignInForm) }));
    app.mount(root);
    await settle();
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "123";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    set(account, view({ kind: "sign-in", email: "a@b.c", step: "code" }));
    await settle();
    expect((root.querySelector("input") as HTMLInputElement).value).toContain("123");
  });
  it("still clears the code on a new step", async () => {
    set(account, view({ kind: "sign-in", email: "a@b.c", step: "code" }));
    app = createApp(defineComponent({ render: () => h(SignInForm) }));
    app.mount(root);
    await settle();
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "123";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    set(account, view({ kind: "sign-in", email: "a@b.c", step: "create" }));
    await nextTick();
    expect(root.querySelector("input[inputmode]")).toBeNull();
  });
  it("keeps the change-email code when the same step is sent again", async () => {
    set(account, { ...view({ kind: "change-email", email: "n@e.w", proof: "none" }), account: { email: "o@l.d", discord: null, createdAt: "2026-10-16T12:00:00.000Z" } });
    app = createApp(defineComponent({ render: () => h(AccountSection, { highlight: null }) }));
    app.mount(root);
    await settle();
    await type("account-code", "123");
    set(account, { ...view({ kind: "change-email", email: "n@e.w", proof: "none" }), account: { email: "o@l.d", discord: null, createdAt: "2026-10-16T12:00:00.000Z" } });
    await settle();
    expect(($("account-code") as HTMLInputElement).value).toContain("123");
  });
});
