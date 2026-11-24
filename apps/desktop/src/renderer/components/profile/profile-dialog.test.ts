// @vitest-environment jsdom
// The profile dialog (bug hunt B, 2026-11-24): the name typed follows the real profile when that changes underneath, a
// save made while another runs is not lost, and Save in the cropper waits for the picture being stored. The real
// ProfileDialog and ProfileEditor run; the host is a fake and the other parts are plain elements.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";

const host = vi.hoisted(() => ({ act: vi.fn() }));
vi.mock("../../host", async () => {
  const { shallowRef } = await import("vue");
  return {
    act: host.act,
    api: { profileRanks: () => Promise.resolve({ online: false, signedIn: true, modules: [] }) },
    showToast: vi.fn(),
    account: shallowRef(null),
    cloudCopy: shallowRef(null),
    inbox: shallowRef({ active: false }),
    profileOpen: shallowRef(false),
    profileTarget: shallowRef("profile"),
    state: shallowRef(null),
  };
});
const plain = vi.hoisted(() => async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("../settings/AccountSection.vue", plain);
vi.mock("../settings/CloudCopySettings.vue", plain);
vi.mock("../settings/MessagesSettings.vue", plain);
vi.mock("../settings/SettingGroup.vue", plain);
vi.mock("./BannerPicker.vue", plain);
vi.mock("./ProfileAvatar.vue", plain);
vi.mock("./ProfileBanner.vue", plain);
vi.mock("../settings/SettingRow.vue", plain);
vi.mock("./picture", () => ({ readPicture: async () => "data:image/png;base64,AA" }));
// The cropper as one Save button that shows whether it is told to wait.
vi.mock("../ImageCropDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { __esModule: true, default: defineComponent({ props: { src: String, busy: Boolean }, emits: ["save", "cancel"], setup: (props, { emit }) => () => (props.src ? h("button", { "data-testid": "crop-save", "data-busy": String(props.busy), disabled: props.busy, onClick: () => emit("save", "PNG") }) : null) }) };
});
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const box = defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => h("div", slots.default?.()) });
  return { Dialog: box, DialogClose: box, DialogContent: box, DialogTitle: box };
});
vi.mock("@tavora/official-ui/components/ui/nav-list", async () => ({ NavList: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("@tavora/official-ui/components/ui/button", async () => ({ Button: (await plain()).default }));
vi.mock("@tavora/official-ui/components/ui/select", async () => {
  const box = (await plain()).default;
  return { Select: box, SelectContent: box, SelectItem: box, SelectTrigger: box, SelectValue: box };
});
vi.mock("@tavora/official-ui/components/ui/switch", async () => ({ Switch: (await import("vue")).defineComponent({ render: () => null }) }));

import { profileOpen, state } from "../../host";
import ProfileDialog from "./ProfileDialog.vue";

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
const set = <T>(ref: unknown, value: T) => ((ref as { value: T }).value = value);
const profile = (name: string, initials: string) => ({ profile: { name, initials, banner: null, pictureUrl: null, ranks: { hidden: true, period: "day" } } });

let app: App | undefined;
let root: HTMLElement;
beforeEach(async () => {
  host.act.mockReset();
  host.act.mockResolvedValue({ ok: true });
  set(state, profile("Old", "O"));
  set(profileOpen, false);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(defineComponent({ render: () => h(ProfileDialog) }));
  app.mount(root);
  set(profileOpen, true);
  await settle();
});
afterEach(() => {
  set(profileOpen, false);
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});

const $ = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
const type = async (id: string, value: string) => {
  $(id).value = value;
  $(id).dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}

describe("the name typed in the profile dialog", () => {
  it("follows the real profile when it changes underneath", async () => {
    expect($("profile-name").value).toBe("Old");
    set(state, profile("Account", "AC"));
    await settle();
    expect($("profile-name").value).toBe("Account");
    expect($("profile-initials").value).toBe("AC");
  });

  it("keeps a field the user typed in", async () => {
    await type("profile-name", "Typed");
    set(state, profile("Account", "AC"));
    await settle();
    expect($("profile-name").value).toBe("Typed");
    expect($("profile-initials").value).toBe("AC");
  });
});

describe("saving the name", () => {
  it("saves what was typed while the first save ran", async () => {
    const first = deferred<{ ok: true }>();
    host.act.mockImplementationOnce(() => first.promise);
    await type("profile-name", "A");
    $("profile-name").dispatchEvent(new Event("blur"));
    await type("profile-name", "AB");
    $("profile-name").dispatchEvent(new Event("blur"));
    await settle();
    expect(host.act).toHaveBeenCalledTimes(1);
    set(state, profile("A", "O"));
    first.resolve({ ok: true });
    await settle();
    expect(host.act).toHaveBeenCalledTimes(2);
    expect(host.act.mock.calls[1]![0]).toMatchObject({ type: "save-profile", name: "AB" });
  });
});

describe("saving the picture", () => {
  it("makes Save in the cropper wait while it is stored", async () => {
    const file = new File(["x"], "me.png", { type: "image/png" });
    const input = $("profile-file");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    await settle();
    await settle();
    const stored = deferred<{ ok: true }>();
    host.act.mockImplementationOnce(() => stored.promise);
    $("crop-save").click();
    await settle();
    expect($("crop-save").dataset.busy).toBe("true");
    stored.resolve({ ok: true });
    await settle();
    expect(root.querySelector('[data-testid="crop-save"]')).toBeNull();
    expect(host.act).toHaveBeenCalledTimes(1);
  });
});
