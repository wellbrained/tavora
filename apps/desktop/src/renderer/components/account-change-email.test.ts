// @vitest-environment jsdom
// Profile > Account, changing the email (decided 2026-11-13): the new address's code and proof of the current one,
// a second code or a fresh Discord sign-in, as the step the main process keeps says. The host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";
import type { AccountView, ChangeEmailProof } from "../../shared/host-api";

const host = vi.hoisted(() => ({
  act: vi.fn(),
  confirmAction: vi.fn(),
  notSaved: vi.fn(),
  prompt: vi.fn(),
  submitAction: vi.fn(),
}));
vi.mock("../host", async () => {
  const { shallowRef } = await import("vue");
  return { ...host, account: shallowRef(null) };
});
// Parts of the page this test is not about.
vi.mock("./settings/RecoveryKeySettings.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./settings/SignInForm.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
// Plain rows, without the details popups the real row sets up.
vi.mock("./settings/SettingRow.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { label: String, description: String }, setup: (props, { slots }) => () => h("div", [props.label, props.description, slots.default?.()]) }) };
});

import { account } from "../host";
import AccountSection from "./settings/AccountSection.vue";

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
const confirmButton = () => $("account-confirm-email") as HTMLButtonElement;

function view(email: string | null, proof: ChangeEmailProof): AccountView {
  return {
    enabled: true,
    canKeepSignIn: true,
    discordLogin: true,
    account: { email, discord: email ? null : { name: "alex" }, createdAt: "2026-10-16T12:00:00.000Z" },
    devices: [],
    pending: { kind: "change-email", email: "new@example.com", proof },
  } as unknown as AccountView;
}

async function mount(email: string | null, proof: ChangeEmailProof) {
  (account as { value: AccountView | null }).value = view(email, proof);
  app = createApp(defineComponent({ render: () => h(AccountSection, { highlight: null }) }));
  app.mount(root);
  await settle();
}

describe("changing the email", () => {
  it("asks for both codes and sends them together", async () => {
    await mount("old@example.com", "code");
    expect($("account-change-email-step")!.dataset.status).toBe("code");
    expect(root.textContent).toContain("new@example.com");
    expect(root.textContent).toContain("old@example.com");
    await type("account-code", "123 456");
    // One code is not enough.
    expect(confirmButton().disabled).toBe(true);
    await type("account-current-code", "654-321");
    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    await settle();
    expect(host.act).toHaveBeenCalledWith({ type: "account-change-email", code: "123456", currentCode: "654321" });
  });

  it("for an account without an address, takes the new address's code and then Discord", async () => {
    await mount(null, "discord");
    expect($("account-current-code")).toBeNull();
    expect(confirmButton().textContent).toContain("Confirm with Discord");
    await type("account-code", "123456");
    confirmButton().click();
    await settle();
    expect(host.act).toHaveBeenCalledWith({ type: "account-change-email", code: "123456" });
  });

  it("with a service from before, asks only for the new address's code", async () => {
    await mount("old@example.com", "none");
    expect($("account-current-code")).toBeNull();
    await type("account-code", "123456");
    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    await settle();
    expect(host.act).toHaveBeenCalledWith({ type: "account-change-email", code: "123456" });
  });
});
