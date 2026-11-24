// @vitest-environment jsdom
// The rail row being dragged dims a frame after the drag starts, and stays as it was when the drag ended in between.
// The real WorkspaceRail runs; its parts are plain elements and the host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";

vi.mock("../host", async () => {
  const { shallowRef } = await import("vue");
  const workspace = { id: "w1", name: "Valheim" };
  return {
    act: vi.fn(),
    dialog: shallowRef(null),
    openSettings: vi.fn(),
    prompt: vi.fn(),
    railToggles: shallowRef(0),
    submitAction: vi.fn(),
    state: shallowRef({
      screen: "workspace",
      currentWorkspaceId: "w1",
      library: { rail: { expanded: true, width: 260 }, sort: "manual", favorites: [], folders: {}, workspaces: { w1: workspace }, root: [{ kind: "workspace", id: "w1" }] },
    }),
  };
});
vi.mock("@tavora/official-ui/components/ui/animated-list", async () => {
  const { defineComponent, h } = await import("vue");
  return { AnimatedList: defineComponent({ props: { skip: Function }, setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("@tavora/official-ui/components/ui/reorder", () => ({
  liftedDragImage: () => undefined,
  useReorderMotion: () => ({ begin: () => undefined, cancel: () => undefined, bind: () => undefined, move: () => undefined, settle: () => undefined, onAnimationEnd: () => undefined }),
}));
// The row as a plain element that takes the rail's drag handlers.
vi.mock("./RailWorkspace.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ inheritAttrs: false, props: { workspace: Object, testid: String }, setup: (props, { attrs }) => () => h("div", { ...attrs, "data-testid": props.testid, draggable: "true" }) }) };
});
const plain = vi.hoisted(() => async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("./menus/MenuArea.vue", plain);
vi.mock("./profile/ProfileMenu.vue", plain);
vi.mock("./RailFooterTile.vue", plain);
vi.mock("./RailInboxButton.vue", plain);
vi.mock("./RailModuleUpdates.vue", plain);
vi.mock("./RailOverlayButton.vue", plain);
vi.mock("./RunningGameButton.vue", plain);
vi.mock("./UpdateMarker.vue", plain);
vi.mock("./FolderTile.vue", plain);
vi.mock("./RailTooltip.vue", plain);

import WorkspaceRail from "./WorkspaceRail.vue";

let app: App | undefined;
let root: HTMLElement;
const frames: FrameRequestCallback[] = [];
beforeEach(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  frames.length = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(defineComponent({ render: () => h(WorkspaceRail) }));
  app.mount(root);
});
afterEach(() => {
  app?.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const row = () => root.querySelector('[data-testid="rail-workspace-w1"]') as HTMLElement;
const fire = (type: string) => row().dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
const nextFrame = () => frames.splice(0).forEach((callback) => callback(0));

describe("the rail row being dragged", () => {
  it("dims on the frame after the drag starts", () => {
    fire("dragstart");
    nextFrame();
    expect(row().classList.contains("drag-source")).toBe(true);
    fire("dragend");
    expect(row().classList.contains("drag-source")).toBe(false);
  });

  it("is not dimmed when the drag ended before that frame", () => {
    fire("dragstart");
    fire("dragend");
    nextFrame();
    expect(row().classList.contains("drag-source")).toBe(false);
  });
});
