// mountPanel: starts a module's real page code in the current document, the way Tavora loads a panel, with a memory host
// in place of Tavora. Framework-free: the test says how the page starts (`createApp(App).mount(container)`, a React root,
// plain DOM), and the module's own `connect()` / `bootstrapModule()` / `connectModule()` gets this panel's memory host.
import type { TavoraSDK } from "../index.js";
import { dropTestSdk, putTestSdk } from "../test-slot.js";
import { createMemoryHost, type MemoryHost, type MemoryHostOptions } from "../testing.js";
import { themeOf } from "./themes.js";

/** Takes a started page down again (unmounts the app). May be async. @since 0.3.14 */
export type StopPanel = () => void | Promise<void>;

/** The panel that is starting, as `start` gets it: its host is ready before the page makes a call. @since 0.3.15 */
export interface StartingPanel {
  /** The SDK the page's `connect()` will get. */
  readonly sdk: TavoraSDK;
  /** This panel's memory host: script what the page asks for at once (`host.answer`) before the page starts. */
  readonly host: MemoryHost;
}

/** @since 0.3.14 */
export interface MountPanelOptions extends MemoryHostOptions {
  /**
   * Starts the module's page in `container`, the way its entry file does, and returns how to take it down. The page's
   * code calls `connect()` (directly or through `bootstrapModule()` or the kit's `connectModule()`) and gets this panel's
   * memory host (a later `connect()` of the page gets the same one, as in Tavora). `panel` (since 0.3.15) has that host
   * already, so calls the page makes as it starts can be scripted first.
   *
   * ```ts
   * start: (container, { host }) => {
   *   host.answer("discord.state", () => ({ ...connected }));
   *   const app = createApp(App);
   *   app.mount(container);
   *   return () => app.unmount();
   * }
   * ```
   */
  start(container: HTMLElement, panel: StartingPanel): void | StopPanel | Promise<void | StopPanel>;
  /** Where the panel draws. Default: a new element, as wide as the page and as tall as the window, added to `document.body`. */
  container?: HTMLElement;
  /** How long the page may take to call `connect()`. Default 10000 ms. */
  connectTimeoutMs?: number;
}

/** @since 0.3.14 */
export interface MountedPanel {
  /** The SDK the page got. */
  readonly sdk: TavoraSDK;
  /** The test's controls for this panel's host (see `createMemoryHost`). */
  readonly host: MemoryHost;
  /** Where the panel draws. */
  readonly container: HTMLElement;
  /**
   * Closes the panel as Tavora does when the user closes it: `lifecycle.onDispose` fires, then the page is taken down
   * (`start`'s stop runs; a container `mountPanel` made is removed). What the module saved stays: mount it again with
   * `share: panel.host` to reopen it. As Tavora restores a panel (after a restart, say), it also gets its own state and
   * content back: `{ share: panel.host, state: panel.host.state, launch: { reason: "restore", content: panel.host.content } }`.
   * Safe to call twice.
   */
  unmount(): Promise<void>;
}

interface Registered {
  container: HTMLElement;
  host: MemoryHost;
}

/** Panels on the page now, for counting a press as a gesture in the right one. */
const mounted = new Set<Registered>();
let lastPressed: Registered | undefined;
let listening: Document | undefined;
let queue: Promise<unknown> = Promise.resolve();

/**
 * A press (mouse button, touch, key) is the user's own action in a panel, as in Tavora, where one press lets one call
 * through that needs it. The panel is the one pressed in; a press outside every panel (a dialog or menu drawn at the end
 * of the page) belongs to the panel pressed last, or to the only one.
 */
function onPress(event: Event) {
  const target = event.target instanceof Node ? event.target : null;
  let panel = target ? [...mounted].find((one) => one.container.contains(target)) : undefined;
  if (!panel) panel = lastPressed && mounted.has(lastPressed) ? lastPressed : mounted.size === 1 ? [...mounted][0] : undefined;
  if (!panel) return;
  lastPressed = panel;
  panel.host.gesture(1);
}

function listen(doc: Document) {
  if (listening === doc) return;
  if (listening) for (const type of ["pointerdown", "keydown"]) listening.removeEventListener(type, onPress, true);
  for (const type of ["pointerdown", "keydown"]) doc.addEventListener(type, onPress, true);
  listening = doc;
}

/**
 * Starts a module's real page code with a memory host in place of Tavora, as Tavora loads a panel, and waits until the page
 * has connected. It takes every option of `createMemoryHost`, with two defaults that match Tavora rather than a unit test:
 * calls that need a click or key press are refused without one (`gestures: "enforce"`; a real press in the panel counts,
 * `host.gesture()` gives one by hand), and the theme is Tavora Dark (`themeOf("dark")`). Needs a DOM: a browser, or jsdom
 * and the like. Panels start one at a time, so each gets its own host; pass `share: other.host` for a second panel of the
 * same module, or to reopen a closed one.
 *
 * ```ts
 * const panel = await mountPanel({ language: "de", start: (container) => { createApp(App).mount(container); } });
 * panel.host.storage.get("view");
 * await panel.unmount();
 * ```
 *
 * @since 0.3.14
 */
export function mountPanel(options: MountPanelOptions): Promise<MountedPanel> {
  const run = queue.then(() => mountNow(options));
  queue = run.catch(() => undefined);
  return run;
}

async function mountNow(options: MountPanelOptions): Promise<MountedPanel> {
  const { start, container: given, connectTimeoutMs = 10_000, ...hostOptions } = options;
  if (typeof start !== "function") throw new TypeError("mountPanel needs start(container), which starts the module's page");
  if (typeof document === "undefined") throw new TypeError("mountPanel needs a DOM: run it in a browser, or in a test environment such as jsdom");
  const { sdk, host } = createMemoryHost({ gestures: "enforce", theme: themeOf("dark"), ...hostOptions });

  const container = given ?? document.createElement("div");
  if (!given) {
    container.setAttribute("data-tavora-panel", "");
    container.style.cssText = "position:relative;width:100%;height:100vh";
    document.body.append(container);
  }
  const entry: Registered = { container, host };
  mounted.add(entry);
  listen(container.ownerDocument);

  let stop: StopPanel | undefined;
  let closed = false;
  const unmount = async () => {
    if (closed) return;
    closed = true;
    host.dispose();
    dropTestSdk(sdk);
    mounted.delete(entry);
    if (lastPressed === entry) lastPressed = undefined;
    try {
      await stop?.();
    } finally {
      if (!given) container.remove();
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const connected = new Promise<void>((resolve, reject) => {
    putTestSdk({ sdk, taken: resolve });
    timer = setTimeout(
      () => reject(new Error(`The panel did not connect within ${connectTimeoutMs} ms: its page must call connect(), bootstrapModule() or connectModule() when it starts`)),
      connectTimeoutMs,
    );
  });
  try {
    stop = (await start(container, { sdk, host })) ?? undefined;
    await connected;
  } catch (error) {
    await unmount().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    putTestSdk(undefined);
  }
  return { sdk, host, container, unmount };
}
