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
  settled: Promise<void> = Promise.resolve();
  bounds: PanelRect | null = null;
  visible = false;
  suspended = false;
  inDialog = false;
  maximized = false;
  focused = 0;
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
  focus(): void {
    this.focused++;
  }
  setMaximized(maximized: boolean): void {
    this.maximized = maximized;
  }
  capture(): Promise<string | null> {
    return Promise.resolve(this.image);
  }
  /** How the last dispose was asked for: `now` when the panel's data is being deleted. */
  disposedNow: boolean | undefined;
  dispose(now?: boolean): Promise<void> {
    this.disposed = true;
    this.disposedNow = now ?? false;
    return Promise.resolve();
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
  /** What the host UI shows under the views after each send. */
  frozen: Record<string, string>[];
  /** What each `frozen` call changed (a picture's URL, or null for none any more). */
  sent: Record<string, string | null>[];
  /** The pictures each `frozen` call said it waits for. */
  awaited: string[][];
  ended: { show: boolean; tag: string }[];
  /** Lends a panel to the in-game layer; `revoked <id>` is noted in `calls` if the panel closes meanwhile. */
  lend(instanceId: string): PanelLease;
  /** Opens a panel with a new in-memory view. */
  add(instanceId: string, kind?: "module" | "browser", moduleId?: string): MemoryPanelView;
}

export function panelViewsRig(overrides: Partial<PanelViewsDeps> = {}): PanelViewsRig {
  const world = { size: { width: 1000, height: 800 }, hidden: false, gone: false, away: new Set<string>(), asking: new Set<string>() };
  const mounted = new Set<object>();
  const calls: string[] = [];
  const frozen: Record<string, string>[] = [];
  const awaited: string[][] = [];
  const sent: Record<string, string | null>[] = [];
  const ended: { show: boolean; tag: string }[] = [];
  const views = new PanelViews({
    mount: (adapter) => void mounted.add(adapter.view),
    unmount: (adapter) => void mounted.delete(adapter.view),
    windowSize: () => world.size,
    windowHidden: () => world.hidden,
    asking: (id) => world.asking.has(id),
    releasing: (id, forget) => void calls.push(`releasing ${id} ${forget}`),
    moduleGone: (moduleId) => void calls.push(`moduleGone ${moduleId}`),
    shownHere: (id) => !world.away.has(id),
    returned: (id) => void calls.push(`returned ${id}`),
    dialogClosed: () => void calls.push("dialogClosed"),
    dialogDrawn: (id) => void calls.push(`dialogDrawn ${id}`),
    openingEnded: ({ show, tag }) => void ended.push({ show, tag }),
    overlayOpening: () => void calls.push("overlayOpening"),
    // Panel views sends only what changed: each entry here is what the host UI shows after that send.
    frozen: (changes, waitFor) => {
      const shown = { ...frozen.at(-1) };
      for (const [id, picture] of Object.entries(changes)) {
        if (picture) shown[id] = picture.url;
        else delete shown[id];
      }
      frozen.push(shown);
      sent.push(Object.fromEntries(Object.entries(changes).map(([id, picture]) => [id, picture?.url ?? null])));
      awaited.push(waitFor);
    },
    frozenOnScreen: () => Promise.resolve(),
    overlayReady: (seq) => void calls.push(seq ? `overlayReady ${seq}` : "overlayReady"),
    windowGone: () => world.gone,
    ...overrides,
  });
  return {
    views,
    world,
    mounted,
    calls,
    frozen,
    sent,
    awaited,
    ended,
    lend(instanceId) {
      const lease = views.lend(instanceId, () => void calls.push(`revoked ${instanceId}`));
      if (!lease) throw new Error(`${instanceId} cannot be lent`);
      return lease;
    },
    add(instanceId, kind = "module", moduleId = "m") {
      const adapter = new MemoryPanelView(kind);
      views.open({ instanceId, moduleId }, () => ({ adapter, start: () => void mounted.add(adapter.view) }));
      return adapter;
    },
  };
}
