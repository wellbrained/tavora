// @vitest-environment jsdom
// Settings > Developer > Publishing > Publisher keys and CI: a short note on each key, a fixed label on Tavora's own key,
// renaming a publish token, and the token form that says what to type. The host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";
import type { AccountView, DeveloperKeysView } from "../../shared/host-api";

const host = vi.hoisted(() => ({
  act: vi.fn(),
  confirmAction: vi.fn(),
  prompt: vi.fn(),
  showToast: vi.fn(),
  submitAction: vi.fn(),
}));
vi.mock("../host", async () => {
  const { shallowRef, computed } = await import("vue");
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
vi.mock("./developer/PrefixClaim.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./developer/ContactChoice.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./settings/SettingRow.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { label: String, description: String }, setup: (props, { slots }) => () => h("div", [props.label, props.description, slots.default?.()]) }) };
});

import { account, developerKeys } from "../host";
import ModuleDeveloperSettings from "./developer/ModuleDeveloperSettings.vue";

const MINE = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
/** The main process marks Tavora's own key `official` (account.test.ts); here it is just a key so marked. */
const OFFICIAL = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LINKED_AT = "2026-11-01T12:00:00.000Z";
const TOKEN = { id: "tok_1", name: "Operator", createdAt: LINKED_AT, expiresAt: "2027-11-01T12:00:00.000Z", lastUsedAt: null };

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  host.act.mockReset();
  host.act.mockResolvedValue({ ok: true });
  host.prompt.mockReset();
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});
const $ = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

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
  (developerKeys as { value: DeveloperKeysView | null }).value = { status: "ready", keys: [{ fingerprint: MINE }], hasKey: true } as unknown as DeveloperKeysView;
  app = createApp(defineComponent({ render: () => h(ModuleDeveloperSettings as never, { highlight: null }) }));
  app.mount(root);
  await tick();
  // The keys and tokens are folded away until opened.
  $("developer-ci-toggle")!.click();
  await tick();
}

describe("notes on publisher keys", () => {
  it("shows the note of a key, Add note on one without, and a fixed label on Tavora's own key", async () => {
    await mount({
      publisherKeys: [
        { fingerprint: MINE, linkedAt: LINKED_AT, note: "Nik's laptop" },
        { fingerprint: OTHER, linkedAt: LINKED_AT, note: null },
        { fingerprint: OFFICIAL, linkedAt: LINKED_AT, note: null, official: true },
      ],
    });
    expect($(`developer-key-note-${MINE}`)?.textContent).toContain("Nik's laptop");
    expect($(`developer-key-note-${MINE}`)?.textContent).toContain("Edit note");
    expect($(`developer-key-note-${OTHER}`)?.textContent?.trim()).toBe("Add note");
    expect($(`developer-key-official-${OFFICIAL}`)?.textContent).toBe("Tavora official");
    // The official key has a label of its own and no note to edit.
    expect($(`developer-key-note-${OFFICIAL}`)).toBeNull();
  });

  it("opens a small dialog with the note, saves it trimmed, and shows the service's refusal", async () => {
    await mount({ publisherKeys: [{ fingerprint: MINE, linkedAt: LINKED_AT, note: "Old" }] });
    $(`developer-key-note-${MINE}`)!.querySelector("button")!.click();
    expect(host.prompt).toHaveBeenCalledTimes(1);
    const request = host.prompt.mock.calls[0]![0] as { title: string; label: string; value: string; maxLength: number; submit(value: string): Promise<string | null> };
    expect(request).toMatchObject({ title: "Note for this key", label: "What is this key for?", value: "Old", maxLength: 60 });

    expect(await request.submit("  GitHub Actions ")).toBeNull();
    expect(host.act).toHaveBeenLastCalledWith({ type: "account-key-note", fingerprint: MINE, note: "GitHub Actions" }, { quiet: true });
    // An empty note clears it.
    expect(await request.submit("   ")).toBeNull();
    expect(host.act).toHaveBeenLastCalledWith({ type: "account-key-note", fingerprint: MINE, note: "" }, { quiet: true });
    host.act.mockResolvedValueOnce({ ok: false, error: "Can't reach Tavora right now." });
    expect(await request.submit("x")).toBe("Can't reach Tavora right now.");
  });

  it("starts the dialog empty for a key without a note", async () => {
    await mount({ publisherKeys: [{ fingerprint: OTHER, linkedAt: LINKED_AT }] });
    $(`developer-key-note-${OTHER}`)!.querySelector("button")!.click();
    expect(host.prompt.mock.calls[0]![0]).toMatchObject({ value: "" });
  });
});

describe("publish tokens", () => {
  it("renames a token through the small dialog, and turns down an empty name", async () => {
    await mount({ publishTokens: [TOKEN] });
    $(`publish-token-rename-${TOKEN.id}`)!.click();
    const request = host.prompt.mock.calls[0]![0] as { title: string; label: string; value: string; maxLength: number; submit(value: string): Promise<string | null> };
    expect(request).toMatchObject({ title: "Rename token", label: "Token name", value: "Operator", maxLength: 40 });
    expect(await request.submit("  Release build ")).toBeNull();
    expect(host.act).toHaveBeenLastCalledWith({ type: "account-publish-token-rename", id: TOKEN.id, name: "Release build" }, { quiet: true });
    host.act.mockClear();
    expect(await request.submit("   ")).toBe("Name can't be empty.");
    expect(host.act).not.toHaveBeenCalled();
  });

  it("has a form that says what to type and what you get", async () => {
    await mount({});
    const form = $("publish-token-name")!.closest("form")!;
    expect(form.querySelector("label")?.textContent).toBe("Token name");
    expect(($("publish-token-name") as HTMLInputElement).placeholder).toBe("Like GitHub Actions");
    expect($("publish-token-create")?.textContent?.trim()).toBe("Make a publish token");
    // The label is tied to the field.
    expect(form.querySelector("label")?.getAttribute("for")).toBe($("publish-token-name")!.id);
  });
});
