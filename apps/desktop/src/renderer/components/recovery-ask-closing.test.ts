// @vitest-environment jsdom
// The recovery key question closes when this PC has the key, or the account is signed out; being offline for a moment
// leaves it open with what was typed. The host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";

const host = vi.hoisted(() => ({ closeDialog: vi.fn(), showToast: vi.fn() }));
vi.mock("../host", async () => {
  const { shallowRef } = await import("vue");
  return { ...host, act: vi.fn(), dialog: shallowRef({ kind: "recovery-ask" }), developerKeys: shallowRef({ status: "ask" }), account: shallowRef({ account: { email: "a@b.c" } }) };
});
const plain = vi.hoisted(() => async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("../ModalDialog.vue", plain);
vi.mock("./PairingAsk.vue", plain);
vi.mock("./settings/PairingAsk.vue", plain);
vi.mock("./ModalDialog.vue", plain);
vi.mock("@tavora/official-ui/components/ui/button", async () => ({ Button: (await plain()).default }));
vi.mock("@tavora/official-ui/components/ui/input", async () => ({ Input: (await plain()).default }));
vi.mock("@tavora/official-ui/components/ui/dialog", async () => ({ DialogButton: (await plain()).default, DialogFooter: (await plain()).default }));

import { account, developerKeys } from "../host";
import RecoveryAskDialog from "./settings/RecoveryAskDialog.vue";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const set = (ref: unknown, value: unknown) => ((ref as { value: unknown }).value = value);

let app: App | undefined;
beforeEach(async () => {
  host.closeDialog.mockReset();
  host.showToast.mockReset();
  set(developerKeys, { status: "ask" });
  set(account, { account: { email: "a@b.c" } });
  app = createApp(defineComponent({ render: () => h(RecoveryAskDialog) }));
  app.mount(document.body.appendChild(document.createElement("div")));
  await settle();
});
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});

describe("the recovery key question", () => {
  it("stays open while offline or loading", async () => {
    for (const status of ["offline", "loading", "ask"]) {
      set(developerKeys, { status });
      await settle();
    }
    expect(host.closeDialog).not.toHaveBeenCalled();
  });

  it("closes with a thanks once this PC has the key", async () => {
    set(developerKeys, { status: "ready" });
    await settle();
    expect(host.closeDialog).toHaveBeenCalledTimes(1);
    expect(host.showToast).toHaveBeenCalledTimes(1);
  });

  it("closes without a thanks when signed out", async () => {
    set(account, { account: null });
    await settle();
    expect(host.closeDialog).toHaveBeenCalledTimes(1);
    expect(host.showToast).not.toHaveBeenCalled();
  });
});
