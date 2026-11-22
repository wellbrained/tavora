// @vitest-environment jsdom
// Settings > Developer > Publishing (audit 2026-11-22): keys paused when the email changed or a device was removed show as
// paused with Link again and Unlink, and the emails the service couldn't send are listed. The host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";
import type { AccountView, DeveloperKeysView } from "../../shared/host-api";

const host = vi.hoisted(() => ({
  act: vi.fn(),
  confirmAction: vi.fn(),
  showToast: vi.fn(),
  submitAction: vi.fn(),
}));
vi.mock("../host", async () => {
  const { shallowRef } = await import("vue");
  return { ...host, account: shallowRef(null), developerKeys: shallowRef(null), inbox: shallowRef({ contactDefault: null }) };
});
// Parts of the page this test is not about.
vi.mock("./developer/PrefixClaim.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./developer/ContactChoice.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./settings/SettingRow.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { label: String, description: String }, setup: (props, { slots }) => () => h("div", [props.label, props.description, slots.default?.()]) }) };
});

import { account, developerKeys } from "../host";
import ModuleDeveloperSettings from "./developer/ModuleDeveloperSettings.vue";

const KEPT = "0123456789abcdef0123456789abcdef";
const FILE = "fedcba9876543210fedcba9876543210";
const LINKED_AT = "2026-11-01T12:00:00.000Z";

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
const $$ = (id: string) => [...root.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];

async function mount(view: Partial<AccountView>) {
  (account as { value: AccountView | null }).value = {
    enabled: true,
    account: { email: "me@example.com", discord: null, createdAt: LINKED_AT },
    developer: { name: "example-dev", nextChangeAt: LINKED_AT },
    publisherKeys: [],
    keyRequests: [],
    publishTokens: [],
    prefixes: { held: [], max: 3 },
    ...view,
  } as unknown as AccountView;
  (developerKeys as { value: DeveloperKeysView | null }).value = { status: "ready", keys: [{ fingerprint: KEPT }], hasKey: true } as unknown as DeveloperKeysView;
  app = createApp(defineComponent({ render: () => h(ModuleDeveloperSettings, { highlight: null }) }));
  app.mount(root);
  await tick();
  await tick();
}

describe("paused publisher keys", () => {
  it("shows each as paused, open, with Link again for a kept key and a link code for a key file", async () => {
    await mount({ pausedKeys: [{ fingerprint: KEPT, linkedAt: LINKED_AT }, { fingerprint: FILE, linkedAt: LINKED_AT }] });
    expect(root.querySelector(`[data-testid="account-key-paused-${KEPT}"]`)?.textContent).toBe("Paused: link it again to publish");
    expect(root.querySelector(`[data-testid="account-key-paused-${FILE}"]`)).not.toBeNull();
    const [kept, file] = $$("account-key-relink");
    kept!.click();
    await tick();
    expect(host.act).toHaveBeenLastCalledWith({ type: "developer-key-link", fingerprint: KEPT });
    file!.click();
    await tick();
    expect(host.act).toHaveBeenLastCalledWith({ type: "account-link-code" });
  });

  it("lists the emails the service couldn't send", async () => {
    await mount({ unsentNotices: [{ kind: "published", id: "example.timer", name: "Timer", version: "1.0.3", at: LINKED_AT }, { kind: "withdrawn", id: "example.timer", name: "Timer", version: "1.0.2", at: LINKED_AT }] });
    const items = $$("developer-unsent-item").map((item) => item.textContent?.trim());
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/^Timer 1\.0\.3 published · /);
    expect(items[1]).toMatch(/^Timer 1\.0\.2 taken back · /);
  });

  it("shows neither without them", async () => {
    await mount({});
    expect($$("developer-unsent")).toEqual([]);
    expect($$("account-key-relink")).toEqual([]);
  });
});
