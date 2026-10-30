import type { InstanceStatus } from "../shared/host-api";
import { PanelViews, type PanelLease, type PanelRect, type PanelViewAdapter, type PanelViewsDeps } from "./panel-views";

let nextContents = 1;

/** A panel view that only remembers what it was told, for tests of Panel views. */
export class MemoryPanelView implements PanelViewAdapter {
  readonly view = {};
  readonly webContentsId = nextContents++;
  status: InstanceStatus = "ready";
  revealed = true;
  firstDrawn = true;
  capturable = true;
  drawn: Promise<void> = Promise.resolve();
  bounds: PanelRect | null = null;
  visible = false;
  suspended = false;
  inDialog = false;
  maximized = false;
  disposed = false;
  image: string | null = "data:image/jpeg;base64,AAAA";

  constructor(readonly kind: "module" | "browser" = "module") {}

  setBounds(rect: PanelRect): void {
    this.bounds = rect;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  suspend(): void {
    this.suspended = true;
  }
  resume(): void {
    this.suspended = false;
  }
  setInDialog(open: boolean): void {
    this.inDialog = open;
  }
  setMaximized(maximized: boolean): void {
    this.maximized = maximized;
  }
  capture(): Promise<string | null> {
    return Promise.resolve(this.image);
  }
  dispose(): void {
    this.disposed = true;
  }
}

export interface PanelViewsRig {
  views: PanelViews;
  /** The window and the host around Panel views, as the tests set them. */
  world: {
    size: { width: number; height: number };
    hidden: boolean;
    gone: boolean;
    /** Panels that belong to a workspace that is not shown. */
    away: Set<string>;
    asking: Set<string>;
  };
  mounted: Set<object>;
  calls: string[];
  frozen: Record<string, string>[];
  ended: { show: boolean; tag: string }[];
  /** Lends a panel to the in-game layer; `revoked <id>` is noted in `calls` if the panel closes meanwhile. */
  lend(instanceId: string): PanelLease;
  /** Opens a panel with a new in-memory view. */
  add(instanceId: string, kind?: "module" | "browser"): MemoryPanelView;
}

export function panelViewsRig(overrides: Partial<PanelViewsDeps> = {}): PanelViewsRig {
  const world = { size: { width: 1000, height: 800 }, hidden: false, gone: false, away: new Set<string>(), asking: new Set<string>() };
  const mounted = new Set<object>();
  const calls: string[] = [];
  const frozen: Record<string, string>[] = [];
  const ended: { show: boolean; tag: string }[] = [];
  const views = new PanelViews({
    mount: (adapter) => void mounted.add(adapter.view),
    unmount: (adapter) => void mounted.delete(adapter.view),
    windowSize: () => world.size,
    windowHidden: () => world.hidden,
    asking: (id) => world.asking.has(id),
    releasing: (id, forget) => void calls.push(`releasing ${id} ${forget}`),
    shownHere: (id) => !world.away.has(id),
    returned: (id) => void calls.push(`returned ${id}`),
    dialogClosed: () => void calls.push("dialogClosed"),
    openingEnded: ({ show, tag }) => void ended.push({ show, tag }),
    overlayOpening: () => void calls.push("overlayOpening"),
    frozen: (images) => void frozen.push(images),
    frozenOnScreen: () => Promise.resolve(),
    windowGone: () => world.gone,
    ...overrides,
  });
  return {
    views,
    world,
    mounted,
    calls,
    frozen,
    ended,
    lend(instanceId) {
      const lease = views.lend(instanceId, () => void calls.push(`revoked ${instanceId}`));
      if (!lease) throw new Error(`${instanceId} cannot be lent`);
      return lease;
    },
    add(instanceId, kind = "module") {
      const adapter = new MemoryPanelView(kind);
      views.open({ instanceId, moduleId: "m" }, () => ({ adapter, start: () => void mounted.add(adapter.view) }));
      return adapter;
    },
  };
}
