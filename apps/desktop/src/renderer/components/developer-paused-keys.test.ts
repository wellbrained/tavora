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
  const { computed } = await import("vue");
  return {
    ...host,
    account: shallowRef(null),
    developerKeys: shallowRef(null),
    inbox: shallowRef({ contactDefault: null }),
    developerReady: computed(() => false),
    dialog: shallowRef(null),
    publishModule: vi.fn(),
    state: shallowRef({ developmentFolders: [] }),
  };
});
// Parts of the page this test is not about.
vi.mock("./developer/PrefixClaim.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./developer/ContactChoice.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./settings/RecoveryKeySettings.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./settings/SignInForm.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
// The dialog's frame, without the real overlay.
vi.mock("./ModalDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("./settings/SettingRow.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { label: String, description: String }, setup: (props, { slots }) => () => h("div", [props.label, props.description, slots.default?.()]) }) };
});

import { account, developerKeys } from "../host";
import DeveloperStartDialog from "./developer/DeveloperStartDialog.vue";
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

async function mount(view: Partial<AccountView>, kept = [{ fingerprint: KEPT }], component: object = ModuleDeveloperSettings) {
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
  (developerKeys as { value: DeveloperKeysView | null }).value = { status: kept.length ? "ready" : "none", keys: kept, hasKey: true } as unknown as DeveloperKeysView;
  app = createApp(defineComponent({ render: () => h(component as never, { highlight: null }) }));
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

  it("offers Lost it? for a paused key whose file is gone", async () => {
    await mount({ pausedKeys: [{ fingerprint: FILE, linkedAt: LINKED_AT }] }, []);
    $$("account-key-replace")[0]!.click();
    await tick();
    (root.querySelector('[data-testid="account-key-lost"]') as HTMLElement).click();
    await tick();
    expect(host.act).toHaveBeenLastCalledWith({ type: "account-replace-key", fingerprint: FILE, leaked: false });
  });

  it("says so while a paused key's replacement waits, and keeps the key meanwhile", async () => {
    await mount(
      {
        pausedKeys: [{ fingerprint: FILE, linkedAt: LINKED_AT }],
        keyRequests: [{ old: FILE, new: KEPT, leaked: false, requestedAt: LINKED_AT, status: "waiting" }],
      },
      [],
    );
    expect($$("account-key-waiting")).toHaveLength(1);
    expect($$("account-key-replace")).toEqual([]);
    expect([...root.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Unlink")).toBe(false);
  });

  it("says a paused key's replacement is done or was turned down, as for a linked key", async () => {
    await mount({ pausedKeys: [{ fingerprint: FILE, linkedAt: LINKED_AT }], keyRequests: [{ old: FILE, new: KEPT, leaked: false, requestedAt: LINKED_AT, status: "done" }] }, []);
    expect($$("account-key-replaced")).toHaveLength(1);
    expect($$("account-key-relink")).toEqual([]);
    app?.unmount();
    app = undefined;
    await mount({ pausedKeys: [{ fingerprint: FILE, linkedAt: LINKED_AT }], keyRequests: [{ old: FILE, new: KEPT, leaked: false, requestedAt: LINKED_AT, status: "declined" }] }, []);
    expect(root.textContent).toContain("Turned down");
    expect($$("account-key-replace")).toHaveLength(1);
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

describe("Publish with paused keys", () => {
  const $ = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const prefixes = { held: [{ prefix: "example", reservedAt: 0 }], max: 3 };

  it("offers Link again for a paused key Tavora keeps, never a new key", async () => {
    await mount({ prefixes, pausedKeys: [{ fingerprint: KEPT, linkedAt: LINKED_AT }] } as unknown as Partial<AccountView>, [{ fingerprint: KEPT }], DeveloperStartDialog);
    expect($("developer-start-make-key")).toBeNull();
    $("developer-start-relink")!.click();
    await tick();
    expect(host.act).toHaveBeenLastCalledWith({ type: "developer-key-link", fingerprint: KEPT });
  });

  it("offers a link code for a paused key file, never a new key", async () => {
    await mount({ prefixes, pausedKeys: [{ fingerprint: FILE, linkedAt: LINKED_AT }] } as unknown as Partial<AccountView>, [], DeveloperStartDialog);
    expect($("developer-start-make-key")).toBeNull();
    expect($("developer-start-paused-file")?.textContent).toContain("Your publisher key file was paused");
    $("developer-start-link-code")!.click();
    await tick();
    expect(host.act).toHaveBeenLastCalledWith({ type: "account-link-code" });
  });
});
