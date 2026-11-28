import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampRect, FREEZE_TIMEOUT_MS, FROZEN_GONE_MS, PREPARED_FRESH_MS, SHOW_DIALOG_CAP_MS, STAND_INS_KEPT } from "./panel-views";
import { panelViewsRig } from "./panel-views.test-helper";
import { dialogPictureKey } from "../shared/dialog-picture";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1);
const B = id(2);
const C = id(3);
const D = id(4);
const place = (instanceId: string, x = 0, y = 0, width = 400, height = 300, extra: object = {}) => ({ instanceId, x, y, width, height, ...extra });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("bounds", () => {
  it("clamps a place to the window and rounds it inwards", () => {
    expect(clampRect({ x: 10.4, y: 20.6, width: 5000, height: 5000 }, { width: 1000, height: 800 })).toEqual({ x: 11, y: 21, width: 989, height: 779 });
  });

  it("never reaches past the place's own edges, so a panel's border stays visible at display scaling", () => {
    // 100.5 + 200.5 ends at 301: rounding each would give 101 + 201 = 302, one pixel over the border.
    const rect = clampRect({ x: 100.5, y: 50.5, width: 200.5, height: 100.5 }, { width: 1000, height: 800 })!;
    expect(rect.x).toBeGreaterThanOrEqual(100.5);
    expect(rect.x + rect.width).toBeLessThanOrEqual(301);
    expect(rect.y + rect.height).toBeLessThanOrEqual(151);
    // Whole numbers stay as they are.
    expect(clampRect({ x: 5, y: 6, width: 700, height: 500 }, { width: 1000, height: 800 })).toEqual({ x: 5, y: 6, width: 700, height: 500 });
  });

  it("gives no place for negative, missing, non-finite or empty ones", () => {
    const size = { width: 1000, height: 800 };
    expect(clampRect({ x: -1, y: 0, width: 5, height: 5 }, size)).toBeNull();
    expect(clampRect({ x: 0, y: 0, width: Number.NaN, height: 5 }, size)).toBeNull();
    expect(clampRect({ x: 0, y: 0, width: "5", height: 5 }, size)).toBeNull();
    expect(clampRect(null, size)).toBeNull();
    expect(clampRect({ x: 1000, y: 0, width: 50, height: 50 }, size)).toBeNull();
  });

  it("places views where the host UI said and hides those it left out", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    rig.views.place([place(A, 5, 6, 700, 500)]);
    expect(a.bounds).toEqual({ x: 5, y: 6, width: 700, height: 500 });
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);
    expect(b.suspended).toBe(true);
    expect(rig.views.isPlaced(B)).toBe(false);
  });

  it("ignores places for unknown panels, bad ids and too many panels", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.views.place([place(A), place(B), place("nope")]);
    expect(rig.views.placedCount()).toBe(1);
    rig.views.place(Array.from({ length: 201 }, () => place(A)));
    expect(rig.views.placedCount()).toBe(1);
    rig.views.place("not a list");
    expect(rig.views.placedCount()).toBe(1);
  });

  it("keeps the place of a panel still waiting for an answer", () => {
    const rig = panelViewsRig();
    rig.views.setAwaiting(A);
    rig.views.place([place(A)]);
    expect(rig.views.isPlaced(A)).toBe(true);
  });

  it("passes the maximized flag on, only for a valid place", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A, 0, 0, 100, 100, { maximized: true })]);
    expect(a.maximized).toBe(true);
    rig.views.place([{ instanceId: A, x: -1, y: 0, width: 5, height: 5, maximized: false }]);
    expect(a.maximized).toBe(true);
  });
});

describe("visibility", () => {
  it("shows a placed, revealed panel and runs it", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    expect(a.visible).toBe(true);
    expect(a.suspended).toBe(false);
  });

  it("keeps a module page hidden until it has its data, a browser page never", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B, "browser");
    a.revealed = false;
    rig.views.place([place(A), place(B)]);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(true);
    a.revealed = true;
    rig.views.applyBounds();
    expect(a.visible).toBe(true);
  });

  it("pauses everything while the window is hidden, except nothing is shown without a place", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.world.hidden = true;
    rig.views.applyBounds();
    expect(a.suspended).toBe(true);
  });

  it("keeps a panel running for the overlays going when it is out of sight, also while the window is hidden", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    rig.views.keepRunning(A);
    rig.views.place([place(A), place(B)]);
    expect(a.suspended).toBe(false);
    rig.views.place([]);
    expect(a.visible).toBe(false);
    expect(a.suspended).toBe(false);
    // Tavora minimized: its overlay goes on being fed (StarCraft 2's build card stays), while a panel only in its slot pauses.
    rig.views.place([place(A), place(B)]);
    rig.world.hidden = true;
    rig.views.applyBounds();
    expect(a.suspended).toBe(false);
    expect(b.suspended).toBe(true);
    rig.views.stopKeeping(A);
    rig.views.applyBounds();
    expect(a.suspended).toBe(true);
  });

  it("hides and pauses a panel that shows a question in its place", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.world.asking.add(A);
    rig.views.applyBounds();
    expect(a.visible).toBe(false);
    expect(a.suspended).toBe(true);
    rig.world.asking.delete(A);
    rig.views.applyBounds();
    expect(a.visible).toBe(true);
  });

  it("leaves a panel lent to the in-game layer to its overlay window", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.lend(A);
    a.visible = false;
    a.bounds = null;
    rig.views.applyBounds();
    expect(a.visible).toBe(false);
    expect(a.bounds).toBeNull();
    expect(rig.views.isShowing(A)).toBe(false);
  });

  it("takes a lent panel's view out of the window and puts it back, laid out at once, when it is returned", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.views.bindContents(a, a.webContentsId);
    const lease = rig.lend(A);
    expect(lease.window.panel).toBe(a);
    expect(a.overGame).toBe(true);
    expect(rig.mounted.has(a.view)).toBe(false);
    expect(rig.views.isLent(A)).toBe(true);
    expect(rig.views.isLentContents(a.webContentsId)).toBe(true);
    // Lent once: nobody else can take it, nothing is lent that has no view.
    expect(rig.views.lend(A, "w", () => ({ destroy: () => {} }), () => {})).toBeNull();
    expect(rig.views.lend(B, "w", () => ({ destroy: () => {} }), () => {})).toBeNull();
    lease.giveBack();
    expect(rig.views.isLent(A)).toBe(false);
    expect(rig.views.isLentContents(a.webContentsId)).toBe(false);
    expect(rig.mounted.has(a.view)).toBe(true);
    expect(a.visible).toBe(true);
    expect(rig.calls).toContain(`returned ${A}`);
    // Returned twice, nothing more happens.
    rig.calls.length = 0;
    lease.giveBack();
    expect(rig.calls).toEqual([]);
  });

  it("lets go of a returned panel whose workspace is not shown any more", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    const lease = rig.lend(A);
    rig.world.away.add(A);
    lease.giveBack();
    expect(rig.views.has(A)).toBe(false);
    expect(a.disposed).toBe(true);
    expect(rig.calls).toContain(`releasing ${A} false`);
    expect(rig.calls).not.toContain(`returned ${A}`);
    // Its place stays for when its workspace comes back.
    expect(rig.views.isPlaced(A)).toBe(true);
  });

  it("keeps a returned panel running, hidden, when its workspace is not shown but it is kept for the overlays or with its game", () => {
    for (const why of ["overlay", "game"] as const) {
      const rig = panelViewsRig();
      const a = rig.add(A);
      rig.views.keepRunning(A, why);
      const lease = rig.lend(A);
      rig.world.away.add(A);
      lease.end();
      expect(rig.views.has(A)).toBe(true);
      expect(a.disposed).toBe(false);
      expect(rig.calls).not.toContain(`releasing ${A} false`);
      // Back in the window, out of sight and still running.
      expect(rig.mounted.has(a.view)).toBe(true);
      expect(a.visible).toBe(false);
      expect(a.suspended).toBe(false);
      expect(a.overGame).toBe(false);
      // Once nothing holds it, it goes as usual.
      rig.views.letGo(A, why);
      expect(rig.views.has(A)).toBe(false);
    }
  });

  it("closing a lent panel tells the layer and leaves nothing lent", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    const lease = rig.lend(A);
    rig.views.close(A);
    expect(rig.calls).toContain(`revoked ${A}`);
    expect(rig.views.isLent(A)).toBe(false);
    expect(a.disposed).toBe(true);
    // The layer gives the view back afterwards, to a panel that is gone.
    lease.giveBack();
    expect(rig.mounted.has(a.view)).toBe(false);
    expect(rig.calls).not.toContain(`returned ${A}`);
  });

  it("ends a lend in order: the window lets go of the view first, then the view is back in its slot", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    const lent = rig.lend(A);
    const order: string[] = [];
    const destroy = lent.window.destroy.bind(lent.window);
    lent.window.destroy = () => {
      order.push(`destroyed, over the game ${a.overGame}`);
      destroy();
    };
    const mount = rig.mounted.add.bind(rig.mounted);
    rig.mounted.add = (view) => (order.push(`mounted, over the game ${a.overGame}`), mount(view));
    lent.end();
    expect(order).toEqual(["destroyed, over the game true", "mounted, over the game false"]);
    expect(rig.views.isLent(A)).toBe(false);
    expect(a.visible).toBe(true);
    // Ended twice, or given back after: nothing more happens.
    rig.calls.length = 0;
    lent.end();
    lent.giveBack();
    expect(rig.calls).toEqual([]);
  });

  it("puts the view back in its slot when the window can't be made, and passes the error on", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    expect(() =>
      rig.views.lend(A, "w", () => {
        throw new Error("no window");
      }, () => {}),
    ).toThrow("no window");
    expect(rig.views.isLent(A)).toBe(false);
    expect(rig.mounted.has(a.view)).toBe(true);
    expect(a.visible).toBe(true);
    // Lent again at the next try.
    expect(rig.lend(A).window.panel).toBe(a);
  });

  it("never lets an older lend's steps touch a newer one", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.views.place([place(A)]);
    const first = rig.lend(A);
    first.giveBack();
    const second = rig.lend(A);
    first.giveBack();
    first.end();
    expect(rig.views.isLent(A)).toBe(true);
    second.end();
    expect(rig.views.isLent(A)).toBe(false);
  });

  it("closes the panel's tooltips and menus as its view leaves, and makes a view for a panel whose workspace isn't shown", () => {
    const made: string[] = [];
    const rig = panelViewsRig({
      lending: (id) => void made.push(`lending ${id}`),
      openForGame: (id, workspaceId) => {
        made.push(`open ${id} in ${workspaceId}`);
        if (id === B) rig.add(B);
      },
    });
    rig.add(A);
    rig.lend(A);
    expect(made).toEqual([`lending ${A}`]);
    made.length = 0;
    const lent = rig.views.lend(B, "elden", (panel) => ({ panel, destroy: () => {} }), () => {});
    expect(made).toEqual([`open ${B} in elden`, `lending ${B}`]);
    expect(lent?.window.panel).toBe(rig.views.get(B));
    // One that gets no view isn't lent.
    made.length = 0;
    expect(rig.views.lend(C, "elden", () => ({ destroy: () => {} }), () => {})).toBeNull();
    expect(made).toEqual([`open ${C} in elden`]);
  });

  it("lends no Browser panel, no page that is gone, and nothing once Tavora's window is gone", () => {
    const rig = panelViewsRig();
    const open = vi.fn(() => ({ destroy: () => {} }));
    rig.add(A, "browser");
    expect(rig.views.lend(A, "w", open, () => {})).toBeNull();
    const b = rig.add(B);
    b.gone = true;
    expect(rig.views.lend(B, "w", open, () => {})).toBeNull();
    b.gone = false;
    rig.world.gone = true;
    expect(rig.views.lend(B, "w", open, () => {})).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(rig.views.isLent(A) || rig.views.isLent(B)).toBe(false);
  });

  it("only releasing a lent panel does not tell the layer", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.lend(A);
    rig.views.release(A);
    expect(rig.calls).not.toContain(`revoked ${A}`);
  });

  it("lets a closed panel's page save, unless its data is being deleted", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.close(A);
    expect(a.disposedNow).toBe(false);
    const b = rig.add(B);
    rig.views.close(B, true);
    expect(b.disposedNow).toBe(true);
  });

  it("says a closed panel is done only once its page has closed, so its state is removed after the last save", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    let closePage!: () => void;
    a.dispose = () => ((a.disposed = true), new Promise<void>((resolve) => (closePage = resolve)));
    rig.views.close(A);
    let done = false;
    void rig.views.closed(A).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(false);
    closePage();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    // A panel with no page going is done at once.
    await expect(rig.views.closed(B)).resolves.toBeUndefined();
  });

  it("closing for good forgets what the panel saved only after its page closed", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    let closePage!: () => void;
    a.dispose = () => ((a.disposed = true), new Promise<void>((resolve) => (closePage = resolve)));
    const forgotten: string[] = [];
    void rig.views.closeForGood(A, async () => void forgotten.push(A));
    expect(a.disposed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(forgotten).toEqual([]);
    closePage();
    await vi.advanceTimersByTimeAsync(0);
    expect(forgotten).toEqual([A]);
  });

  it("disposing everything resolves once every page has closed", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    let closePage!: () => void;
    a.dispose = () => ((a.disposed = true), new Promise<void>((resolve) => (closePage = resolve)));
    let done = false;
    void rig.views.disposeAll().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(false);
    closePage();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("disposing everything waits for a page closed a moment ago that is still saving", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    let closePage!: () => void;
    a.dispose = () => ((a.disposed = true), new Promise<void>((resolve) => (closePage = resolve)));
    rig.views.close(A);
    let done = false;
    void rig.views.disposeAll().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(false);
    closePage();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("deleting a panel's data closes at once its page still saving from an earlier release", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const asked: (boolean | undefined)[] = [];
    a.dispose = (now?: boolean) => (asked.push(now), new Promise<void>(() => undefined));
    rig.views.release(A);
    rig.views.close(A, true);
    expect(asked).toEqual([false, true]);
  });

  it("disposing everything goes on past a page that fails to close", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    a.dispose = () => {
      throw new Error("gone wrong");
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(rig.views.disposeAll()).resolves.toBeUndefined();
    error.mockRestore();
    expect(b.disposed).toBe(true);
    expect(rig.views.has(A)).toBe(false);
  });

  it("disposing everything while lent forgets the loans and returns nothing to a gone window", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const lease = rig.lend(A);
    rig.views.disposeAll();
    expect(a.disposed).toBe(true);
    expect(rig.views.isLent(A)).toBe(false);
    lease.giveBack();
    expect(rig.mounted.has(a.view)).toBe(false);
    expect(rig.calls).not.toContain(`revoked ${A}`);
  });

  it("does not put a returned panel back into a window that is gone", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const lease = rig.lend(A);
    rig.world.gone = true;
    lease.giveBack();
    expect(rig.mounted.has(a.view)).toBe(false);
    expect(rig.views.isLent(A)).toBe(false);
  });

  it("says whether a panel may show a tooltip", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    expect(rig.views.isShowing(A)).toBe(false);
    rig.views.place([place(A)]);
    expect(rig.views.isShowing(A)).toBe(true);
    a.revealed = false;
    expect(rig.views.isShowing(A)).toBe(false);
    a.revealed = true;
    rig.world.hidden = true;
    expect(rig.views.isShowing(A)).toBe(false);
  });
});

describe("opening cover", () => {
  it("shows no panel until every placed module page has its data", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    a.revealed = false;
    rig.views.startOpening(5000, "layout");
    expect(rig.views.opening).toBe(true);
    rig.views.place([place(A), place(B, 400)]);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(false);
    expect(rig.views.opening).toBe(true);
    a.revealed = true;
    rig.views.applyBounds();
    expect(rig.views.opening).toBe(false);
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);
    expect(rig.ended).toEqual([{ show: true, tag: "layout" }]);
  });

  it("does not end while nothing is placed yet", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.views.startOpening(5000, "x");
    rig.views.applyBounds();
    expect(rig.views.opening).toBe(true);
  });

  it("ends after the cap even if a page never gets its data", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    a.revealed = false;
    rig.views.place([place(A)]);
    rig.views.startOpening(5000, "x");
    vi.advanceTimersByTime(4999);
    expect(rig.views.opening).toBe(true);
    vi.advanceTimersByTime(1);
    expect(rig.views.opening).toBe(false);
    expect(rig.ended).toEqual([{ show: true, tag: "x" }]);
  });

  it("a new opening ends the old one without showing, and leaving the workspace cancels it", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.views.startOpening(5000, "one");
    rig.views.startOpening(5000, "two");
    expect(rig.ended).toEqual([{ show: false, tag: "one" }]);
    rig.views.closeAll();
    expect(rig.ended.at(-1)).toEqual({ show: false, tag: "two" });
    vi.advanceTimersByTime(10_000);
    expect(rig.ended).toHaveLength(2);
  });
});

describe("host menus and dialogs over the workspace (freeze)", () => {
  it("takes a picture of each shown panel, hides them, and shows them again when closed", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    b.capturable = false;
    rig.views.place([place(A), place(B, 400)]);
    await rig.views.freeze(true);
    expect(rig.calls).toContain("overlayOpening");
    expect(rig.frozen).toEqual([{ [A]: a.image }]);
    expect(rig.views.overlay).toBe(true);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(false);
    const closing = rig.views.freeze(false);
    expect(a.visible).toBe(true);
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    await closing;
    expect(rig.frozen.at(-1)).toEqual({});
  });

  it("says the panels are out of the way only once they are hidden, and not for a freeze that was overtaken", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    let releasePicture: (image: string) => void = () => undefined;
    a.capture = () => new Promise((resolve) => (releasePicture = resolve));
    const freezing = rig.views.freeze(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.calls).not.toContain("overlayReady");
    releasePicture("data:x");
    await freezing;
    expect(a.visible).toBe(false);
    expect(rig.calls.filter((call) => call === "overlayReady")).toHaveLength(1);
    // A freeze with no panel to picture still says it, or a menu would wait for nothing.
    const empty = panelViewsRig();
    await empty.views.freeze(true);
    expect(empty.calls).toContain("overlayReady");
    // Overtaken by a close: the menu is gone, nothing to announce.
    const overtaken = panelViewsRig();
    const b = overtaken.add(B);
    overtaken.views.place([place(B)]);
    b.capture = () => new Promise((resolve) => (releasePicture = resolve));
    const slow = overtaken.views.freeze(true);
    await vi.advanceTimersByTimeAsync(0);
    void overtaken.views.freeze(false);
    releasePicture("data:y");
    await slow;
    expect(overtaken.calls).not.toContain("overlayReady");
  });

  it("uses pictures taken ahead when a menu opens soon after, and takes new ones when they are stale", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    let taken = 0;
    a.capture = () => Promise.resolve(`data:picture-${++taken}`);
    rig.views.prepareFreeze();
    rig.views.prepareFreeze();
    expect(taken).toBe(1);
    await rig.views.freeze(true);
    expect(taken).toBe(1);
    expect(rig.frozen).toEqual([{ [A]: "data:picture-1" }]);
    const closing = rig.views.freeze(false);
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    await closing;
    // Taken ahead but not used in time: the menu takes its own.
    const stale = panelViewsRig({ now: (() => { let t = 0; return () => (t += PREPARED_FRESH_MS); })() });
    const b = stale.add(B);
    stale.views.place([place(B)]);
    let staleTaken = 0;
    b.capture = () => Promise.resolve(`data:stale-${++staleTaken}`);
    stale.views.prepareFreeze();
    await stale.views.freeze(true);
    expect(stale.frozen.at(-1)).toEqual({ [B]: "data:stale-2" });
  });

  it("takes a new picture when the one taken ahead came to nothing", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    let taken = 0;
    a.capture = () => Promise.resolve(++taken === 1 ? null : `data:picture-${taken}`);
    rig.views.prepareFreeze();
    await rig.views.freeze(true);
    expect(taken).toBe(2);
    expect(rig.frozen).toEqual([{ [A]: "data:picture-2" }]);
  });

  it("does not use a picture taken ahead once its panel moved, was lent, got a dialog or went", async () => {
    const changes: [string, (rig: ReturnType<typeof panelViewsRig>) => void][] = [
      ["moved", (rig) => rig.views.place([place(A, 100)])],
      ["lent", (rig) => void rig.lend(A)],
      ["dialog", (rig) => void rig.views.openDialog(A, { width: 300, height: 200 })],
      ["closed", (rig) => rig.views.close(A)],
    ];
    for (const [what, change] of changes) {
      const rig = panelViewsRig();
      const a = rig.add(A);
      rig.views.place([place(A)]);
      let taken = 0;
      a.capture = () => Promise.resolve(`data:${what}-${++taken}`);
      rig.views.prepareFreeze();
      change(rig);
      await rig.views.freeze(true);
      // Taken ahead once; the menu took its own for any panel still pictured.
      expect(taken, what).toBe(rig.frozen.at(-1)?.[A] ? 2 : 1);
      expect(rig.frozen.at(-1)?.[A] ?? "", what).not.toBe(`data:${what}-1`);
    }
  });

  it("takes no pictures ahead while a menu or dialog is open", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    await rig.views.freeze(true);
    let taken = 0;
    a.capture = () => Promise.resolve(`data:${++taken}`);
    rig.views.prepareFreeze();
    expect(taken).toBe(0);
  });

  it("takes no picture of a panel that is not ready, not revealed, lent or unplaced", async () => {
    const rig = panelViewsRig();
    const loading = rig.add(A);
    const hidden = rig.add(B);
    const lent = rig.add(C);
    loading.status = "loading";
    hidden.revealed = false;
    rig.lend(C);
    rig.views.place([place(A), place(B), place(C)]);
    await rig.views.freeze(true);
    expect(rig.frozen).toEqual([]);
    expect(lent.image).not.toBeNull();
  });

  it("gives up on a picture that takes too long", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    a.capture = () => new Promise(() => undefined);
    rig.views.place([place(A)]);
    const freezing = rig.views.freeze(true);
    await vi.advanceTimersByTimeAsync(FREEZE_TIMEOUT_MS);
    await freezing;
    expect(rig.frozen).toEqual([]);
    // Under a dialog (every panel asked) it steps aside all the same: it would draw over the dialog.
    expect(a.visible).toBe(false);
  });

  it("does nothing when the state does not change, and a slow freeze does not hide panels after the overlay closed", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    await rig.views.freeze(false);
    expect(rig.frozen).toEqual([]);
    let release: (image: string) => void = () => undefined;
    a.capture = () => new Promise((resolve) => (release = resolve));
    const freezing = rig.views.freeze(true);
    void rig.views.freeze(false);
    release("data:x");
    await freezing;
    expect(a.visible).toBe(true);
    expect(rig.views.overlay).toBe(false);
  });

  it("keeps views hidden while the overlay is open, whatever lays them out", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    await rig.views.freeze(true);
    rig.views.applyBounds();
    expect(a.visible).toBe(false);
    expect(rig.views.isShowing(A)).toBe(false);
  });
});

describe("only the panels a menu lies over step aside", () => {
  it("hides just the panels asked for, adds more when asked, and answers each request in order", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    const c = rig.add(C);
    rig.views.place([place(A), place(B, 400), place(C, 0, 300)]);
    let releaseA: (image: string) => void = () => undefined;
    a.capture = () => new Promise((resolve) => (releaseA = resolve));
    const first = rig.views.freeze(true, [A], 1);
    const second = rig.views.freeze(true, [B], 2);
    await vi.advanceTimersByTimeAsync(0);
    // The second waits for the first, so its answer never comes before the first's.
    expect(rig.calls.filter((call) => call.startsWith("overlayReady"))).toEqual([]);
    releaseA("data:a");
    await first;
    await second;
    expect(rig.calls.filter((call) => call.startsWith("overlayReady"))).toEqual(["overlayReady 1", "overlayReady 2"]);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(false);
    expect(c.visible).toBe(true);
    expect(rig.frozen.at(-1)).toEqual({ [A]: "data:a", [B]: b.image });
    // Only the new picture is waited for.
    expect(rig.awaited.at(-1)).toEqual([B]);
    // Laid out again meanwhile, the one left out stays live.
    rig.views.applyBounds();
    expect(c.visible).toBe(true);
    // A dialog next: every panel steps aside.
    await rig.views.freeze(true, undefined, 3);
    expect(c.visible).toBe(false);
    expect(rig.calls.at(-1)).toBe("overlayReady 3");
  });

  it("keeps a panel in sight under a menu when its picture came to nothing, so its slot never shows empty", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    a.capture = () => new Promise(() => undefined);
    rig.views.place([place(A)]);
    const freezing = rig.views.freeze(true, [A], 1);
    await vi.advanceTimersByTimeAsync(FREEZE_TIMEOUT_MS);
    await freezing;
    expect(a.visible).toBe(true);
    expect(rig.calls).toContain("overlayReady 1");
  });

  it("keeps a panel in sight while its picture is taken, and hides a panel that comes while every one is asked", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    let release: (image: string) => void = () => undefined;
    a.capture = () => new Promise((resolve) => (release = resolve));
    const freezing = rig.views.freeze(true);
    await vi.advanceTimersByTimeAsync(0);
    // A split dragged meanwhile lays the panels out again: the one being pictured stays until its picture shows.
    rig.views.place([place(A, 0, 0, 380)]);
    expect(a.visible).toBe(true);
    const b = rig.add(B);
    rig.views.place([place(A, 0, 0, 380), place(B, 400)]);
    expect(b.visible).toBe(false);
    release("data:a");
    await freezing;
    expect(a.visible).toBe(false);
  });

  it("takes the pictures away only once each panel has drawn and nothing shows through it", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    await rig.views.freeze(true, [A], 1);
    let settle: () => void = () => undefined;
    a.settled = new Promise((resolve) => (settle = resolve));
    const closing = rig.views.freeze(false);
    expect(a.visible).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rig.frozen.at(-1)).toEqual({ [A]: a.image });
    settle();
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    await closing;
    expect(rig.frozen.at(-1)).toEqual({});
  });

  it("uses a picture taken ahead only while it is young", async () => {
    let clock = 0;
    const rig = panelViewsRig({ now: () => clock });
    const a = rig.add(A);
    rig.views.place([place(A)]);
    let taken = 0;
    a.capture = () => Promise.resolve(`data:picture-${++taken}`);
    rig.views.prepareFreeze();
    await vi.advanceTimersByTimeAsync(0);
    clock += PREPARED_FRESH_MS + 1;
    await rig.views.freeze(true, [A], 1);
    expect(taken).toBe(2);
    expect(rig.frozen.at(-1)).toEqual({ [A]: "data:picture-2" });
  });
});

describe("a panel back in its slot", () => {
  it("lies on its last picture until it has drawn and nothing shows through it", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    expect(a.visible).toBe(true);
    let taken = 0;
    a.capture = () => Promise.resolve(`data:last-${++taken}`);
    // Another tab comes to the front: the picture is asked for before the view goes.
    rig.views.place([]);
    expect(a.visible).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(taken).toBe(1);
    expect(rig.frozen.at(-1)).toEqual({ [A]: "data:last-1" });
    expect(rig.awaited.at(-1)).toEqual([]);
    // Back in front: the picture stays under it until it has drawn and turned solid.
    let settle: () => void = () => undefined;
    a.settled = new Promise((resolve) => (settle = resolve));
    rig.views.place([place(A)]);
    expect(a.visible).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rig.frozen.at(-1)).toEqual({ [A]: "data:last-1" });
    settle();
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    expect(rig.frozen.at(-1)).toEqual({});
  });

  it("shows no old picture when it comes back without its data, crashed, or after the theme changed", async () => {
    const away = async () => {
      const rig = panelViewsRig();
      const a = rig.add(A);
      rig.views.place([place(A)]);
      rig.views.place([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(rig.frozen.at(-1)).toEqual({ [A]: a.image });
      return { rig, a };
    };
    const waiting = await away();
    waiting.a.revealed = false;
    waiting.rig.views.place([place(A)]);
    expect(waiting.rig.frozen.at(-1)).toEqual({});
    const crashed = await away();
    crashed.a.status = "crashed";
    crashed.rig.views.place([place(A)]);
    expect(crashed.rig.frozen.at(-1)).toEqual({});
    const themed = await away();
    themed.rig.views.forgetStandIns();
    expect(themed.rig.frozen.at(-1)).toEqual({});
    const closed = await away();
    closed.rig.views.close(A);
    expect(closed.rig.frozen.at(-1)).toEqual({});
  });

  it("keeps the menu's picture of a panel that left its slot meanwhile, to lie on when it comes back", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    await rig.views.freeze(true, [A], 1);
    rig.views.place([]);
    const closing = rig.views.freeze(false);
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    await closing;
    expect(rig.frozen.at(-1)).toEqual({ [A]: a.image });
    rig.views.place([place(A)]);
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    expect(rig.frozen.at(-1)).toEqual({});
  });

  it("takes no picture of a panel hidden for a menu or one that never showed", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    b.revealed = false;
    rig.views.place([place(A), place(B, 400)]);
    let taken = 0;
    a.capture = () => Promise.resolve(`data:${++taken}`);
    b.capture = a.capture;
    await rig.views.freeze(true, [A], 1);
    expect(taken).toBe(1);
    rig.views.place([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(taken).toBe(1);
  });
});

describe("pictures over a closing and opening menu", () => {
  it("leaves a newer menu's picture alone when an older close finishes, until the panel has settled again", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    let taken = 0;
    a.capture = () => Promise.resolve(`data:a-${++taken}`);
    // A hint opens over A, then closes: thaw 1 waits for A to settle.
    await rig.views.freeze(true, [A], 1);
    let settleFirst: () => void = () => undefined;
    a.settled = new Promise((resolve) => (settleFirst = resolve));
    const thawFirst = rig.views.freeze(false);
    // It opens again at once (A gets a new picture and hides), and closes again: thaw 2 waits for A's next draw.
    await rig.views.freeze(true, [A], 2);
    expect(rig.frozen.at(-1)).toEqual({ [A]: "data:a-2" });
    let settleSecond: () => void = () => undefined;
    a.settled = new Promise((resolve) => (settleSecond = resolve));
    const thawSecond = rig.views.freeze(false);
    // Thaw 1 ends now: A is see-through, so its new picture must stay under it.
    settleFirst();
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    await thawFirst;
    expect(rig.frozen.at(-1)).toEqual({ [A]: "data:a-2" });
    settleSecond();
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    await thawSecond;
    expect(rig.frozen.at(-1)).toEqual({});
  });

  it("takes each panel's picture away as that panel settles, not when the slowest has", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    rig.views.place([place(A), place(B, 400)]);
    b.image = "data:b";
    await rig.views.freeze(true);
    let settleB: () => void = () => undefined;
    b.settled = new Promise((resolve) => (settleB = resolve));
    const closing = rig.views.freeze(false);
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    expect(rig.frozen.at(-1)).toEqual({ [B]: "data:b" });
    settleB();
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    await closing;
    expect(rig.frozen.at(-1)).toEqual({});
    expect(a.visible).toBe(true);
  });

  it("sends only what changed", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    b.image = "data:b";
    rig.views.place([place(A), place(B, 400)]);
    await rig.views.freeze(true, [A], 1);
    await rig.views.freeze(true, [B], 2);
    expect(rig.sent).toEqual([{ [A]: a.image }, { [B]: "data:b" }]);
  });

  it("logs how long the panels took to step aside after asking", async () => {
    const lines: string[] = [];
    const rig = panelViewsRig({ log: (line) => void lines.push(line) });
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.views.prepareFreeze();
    await vi.advanceTimersByTimeAsync(0);
    await rig.views.freeze(true, undefined, 7);
    expect(a.visible).toBe(false);
    expect(lines.at(-1)).toMatch(/^overlay 7: 1 panels out \d+ ms after asking \(1 pictures taken ahead, 0 new\)$/);
  });
});

describe("pictures taken ahead", () => {
  it("are taken only of panels a menu opened near there could reach", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    rig.world.size = { width: 2000, height: 800 };
    rig.views.place([place(A), place(B, 1400)]);
    let takenA = 0;
    let takenB = 0;
    a.capture = () => Promise.resolve(`data:a-${++takenA}`);
    b.capture = () => Promise.resolve(`data:b-${++takenB}`);
    rig.views.prepareFreeze({ x: 100, y: 10, width: 40, height: 20 });
    expect([takenA, takenB]).toEqual([1, 0]);
    // A press that may open a dialog: every panel.
    rig.views.prepareFreeze();
    expect([takenA, takenB]).toEqual([1, 1]);
  });

  it("are kept until used, each once, and a dialog that follows a menu uses the rest without a new capture", async () => {
    let clock = 0;
    const rig = panelViewsRig({ now: () => clock });
    const a = rig.add(A);
    const b = rig.add(B);
    rig.views.place([place(A), place(B, 400)]);
    let taken = 0;
    a.capture = () => Promise.resolve(`data:a-${++taken}`);
    b.capture = () => Promise.resolve(`data:b-${++taken}`);
    rig.views.prepareFreeze();
    await vi.advanceTimersByTimeAsync(0);
    expect(taken).toBe(2);
    clock += 50;
    // A menu over A uses A's; B's is kept.
    await rig.views.freeze(true, [A], 1);
    clock += 50;
    // The menu's entry opens a dialog: B steps aside on the picture taken ahead.
    await rig.views.freeze(true, undefined, 2);
    expect(taken).toBe(2);
    expect(rig.frozen.at(-1)).toEqual({ [A]: "data:a-1", [B]: "data:b-2" });
  });

  it("are not asked again for a panel asked a moment ago, nor for one that is out", async () => {
    let clock = 0;
    const rig = panelViewsRig({ now: () => clock });
    const a = rig.add(A);
    rig.views.place([place(A)]);
    let taken = 0;
    a.capture = () => Promise.resolve(`data:${++taken}`);
    rig.views.prepareFreeze();
    clock += PREPARED_FRESH_MS / 4;
    rig.views.prepareFreeze();
    expect(taken).toBe(1);
    clock += PREPARED_FRESH_MS;
    rig.views.prepareFreeze();
    expect(taken).toBe(2);
    await rig.views.freeze(true, [A], 1);
    clock += PREPARED_FRESH_MS;
    rig.views.prepareFreeze();
    expect(taken).toBe(2);
  });
});

describe("last pictures kept", () => {
  it("keeps one for the last few panels that left their slot", async () => {
    const rig = panelViewsRig();
    const ids = Array.from({ length: STAND_INS_KEPT + 2 }, (_, n) => id(100 + n));
    for (const [n, instanceId] of ids.entries()) {
      const view = rig.add(instanceId);
      view.image = `data:${n}`;
    }
    rig.views.place(ids.map((instanceId, n) => place(instanceId, n * 10, 0, 10, 10)));
    for (const [n] of ids.entries()) {
      rig.views.place(ids.slice(n + 1).map((instanceId, m) => place(instanceId, (n + 1 + m) * 10, 0, 10, 10)));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(Object.keys(rig.frozen.at(-1)!)).toEqual(ids.slice(2));
  });
});

describe("panel dialog", () => {
  it("is for a placed module panel in sight, one at a time", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.add(B, "browser");
    rig.add(C);
    rig.views.place([place(A), place(B)]);
    expect(rig.views.openDialog(B, { width: 1, height: 1 })).toBe(false);
    expect(rig.views.openDialog(C, { width: 1, height: 1 })).toBe(false);
    const lease = rig.lend(A);
    expect(rig.views.openDialog(A, { width: 1, height: 1 })).toBe(false);
    lease.giveBack();
    expect(rig.views.openDialog(A, { width: 600, height: 400 })).toBe(true);
    expect(rig.views.openDialog(A, { width: 600, height: 400 })).toBe(false);
  });

  it("puts the panel in its frame above the dimmed app while the others step aside", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    rig.views.place([place(A), place(B, 400)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.inDialog).toBe(true);
    expect(rig.views.snapshot().dialog).toEqual({ instanceId: A, width: 600, height: 400, placed: false });
    await rig.views.freeze(true);
    rig.views.placeDialog({ x: 100, y: 50, width: 600.4, height: 400 });
    rig.views.showDialog(A);
    expect(a.bounds).toEqual({ x: 100, y: 50, width: 600, height: 400 });
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);
    expect(rig.views.inDialog(A)).toBe(true);
    expect(rig.views.snapshot().dialog?.placed).toBe(true);
  });

  it("focuses the panel's page once it is placed in its frame, and only the first time", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.focused).toBe(0);
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    expect(a.focused).toBe(0);
    rig.views.showDialog(A);
    expect(a.focused).toBe(1);
    rig.views.placeDialog({ x: 100, y: 60, width: 600, height: 400 });
    rig.views.showDialog(A);
    expect(a.focused).toBe(1);
  });

  it("tells the host UI the page has drawn in its frame, so the frame can show, but not for a dialog that closed first", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    let draw = () => {};
    a.drawn = new Promise<void>((resolve) => (draw = resolve));
    rig.views.place([place(A)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.calls).not.toContain(`dialogDrawn ${A}`);
    draw();
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.calls).toContain(`dialogDrawn ${A}`);
    rig.calls.length = 0;
    const b = rig.add(B);
    let drawB = () => {};
    b.drawn = new Promise<void>((resolve) => (drawB = resolve));
    rig.views.place([place(A), place(B, 400)]);
    rig.views.closeDialog();
    rig.views.openDialog(B, { width: 600, height: 400 });
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    rig.views.closeDialog();
    drawB();
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.calls).not.toContain(`dialogDrawn ${B}`);
  });

  it("shows a dialog opened again only by its own wait, not by the one before it", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    await vi.advanceTimersByTimeAsync(SHOW_DIALOG_CAP_MS / 2);
    rig.views.closeDialog();
    rig.views.openDialog(A, { width: 600, height: 400 });
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    // The first opening's wait runs out: the new frame is not on screen yet, so the page stays out of sight.
    await vi.advanceTimersByTimeAsync(SHOW_DIALOG_CAP_MS / 2 + 1);
    expect(a.bounds!.x).toBeLessThan(0);
    // Its own wait does show it.
    await vi.advanceTimersByTimeAsync(SHOW_DIALOG_CAP_MS / 2);
    expect(a.bounds).toEqual({ x: 100, y: 50, width: 600, height: 400 });
  });

  it("keeps the page out of sight until the frame is shown, then moves it in", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    expect(a.bounds!.x + a.bounds!.width).toBeLessThan(0);
    expect(rig.views.snapshot().dialog?.placed).toBe(true);
    rig.views.showDialog("other");
    expect(a.bounds!.x).toBeLessThan(0);
    rig.views.showDialog(A);
    expect(a.bounds).toEqual({ x: 100, y: 50, width: 600, height: 400 });
    expect(a.visible).toBe(true);
  });

  it("moves the page in on its own when the host UI never shows the frame", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.bounds).toEqual({ x: 100, y: 50, width: 600, height: 400 });
  });

  it("does not focus the page of a dialog that closed, or one a question or page dialog covers", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    rig.views.closeDialog();
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    expect(a.focused).toBe(0);
    rig.views.openDialog(A, { width: 600, height: 400 });
    rig.views.coverDialog(true);
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    rig.views.showDialog(A);
    expect(a.focused).toBe(0);
  });

  it("hides the panel's view while a page dialog is above its dialog, and shows it again after", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    await vi.advanceTimersByTimeAsync(0);
    await rig.views.freeze(true);
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    expect(a.visible).toBe(true);
    rig.views.coverDialog(true);
    expect(a.visible).toBe(false);
    rig.views.coverDialog(false);
    expect(a.visible).toBe(true);
  });

  it("keeps the next panel's view hidden when its dialog replaces another's while a page dialog is on top", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    rig.views.place([place(A), place(B, 400)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    await vi.advanceTimersByTimeAsync(0);
    await rig.views.freeze(true);
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    rig.views.coverDialog(true);
    expect(a.visible).toBe(false);
    // The host UI goes from A's dialog straight to B's: it reports no change, the page dialog is still there.
    rig.views.openDialog(B, { width: 500, height: 300 });
    await vi.advanceTimersByTimeAsync(0);
    rig.views.placeDialog({ x: 120, y: 60, width: 500, height: 300 });
    expect(b.visible).toBe(false);
    expect(a.visible).toBe(false);
    // The page dialog closes: B's view comes back.
    rig.views.coverDialog(false);
    expect(b.visible).toBe(true);
  });

  it("ignores a bad frame, and closing puts the panel back in its slot", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A, 10, 10, 300, 200)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    await vi.advanceTimersByTimeAsync(0);
    rig.views.placeDialog({ x: 0, y: 0, width: 0, height: 100 });
    rig.views.placeDialog({ x: "a" });
    expect(rig.views.inDialog(A)).toBe(false);
    rig.views.placeDialog({ x: 100, y: 50, width: 600, height: 400 });
    rig.views.closeDialog(B);
    expect(rig.views.dialog).not.toBeNull();
    rig.views.closeDialog(A);
    expect(rig.views.dialog).toBeNull();
    expect(rig.calls).toContain("dialogClosed");
    expect(a.inDialog).toBe(false);
    expect(a.bounds).toEqual({ x: 10, y: 10, width: 300, height: 200 });
  });

  it("shows the panel as it was before the dialog opened, though its module switched the page when told", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    const before = a.image;
    let release: (image: string | null) => void = () => undefined;
    a.capture = () => new Promise((resolve) => (release = resolve));
    rig.views.openDialog(A, { width: 600, height: 400 });
    // The module is told once the picture is taken, not before.
    await vi.advanceTimersByTimeAsync(0);
    expect(a.inDialog).toBe(false);
    const freezing = rig.views.freeze(true);
    a.capture = () => Promise.resolve("data:image/jpeg;base64,SETTINGS");
    release(before);
    await freezing;
    expect(a.inDialog).toBe(true);
    expect(rig.frozen).toEqual([{ [A]: before }]);
  });

  it("lets a panel with no slot open its dialog (over the Overlay page), telling its module without a picture", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    expect(rig.views.openDialog(A, { width: 600, height: 400 })).toBe(false);
    expect(rig.views.openDialog(A, { width: 600, height: 400 }, true)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.inDialog).toBe(true);
    await rig.views.freeze(true);
    expect(rig.frozen).toEqual([]);
  });

  it("does not tell the module of a dialog that closed before its picture was taken", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    a.capture = () => new Promise(() => undefined);
    rig.views.openDialog(A, { width: 600, height: 400 });
    rig.views.closeDialog(A);
    await vi.advanceTimersByTimeAsync(250);
    expect(a.inDialog).toBe(false);
  });

  it("opens another dialog by closing the one before", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.add(B);
    rig.views.place([place(A), place(B, 400)]);
    rig.views.openDialog(A, { width: 1, height: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.inDialog).toBe(true);
    rig.views.openDialog(B, { width: 2, height: 2 });
    expect(a.inDialog).toBe(false);
    expect(rig.views.dialog?.instanceId).toBe(B);
  });
});

describe("cleanup", () => {
  function everything() {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    for (const instanceId of [A, B]) {
      rig.views.setAwaiting(instanceId);
      rig.views.setLaunch(instanceId, { reason: "add" });
      rig.views.setOpenedFrom(instanceId, { instanceId: C, background: true });
      rig.views.keepRunning(instanceId);
      rig.views.withholdWelcome(instanceId);
    }
    rig.views.place([place(A), place(B, 400)]);
    rig.views.bindContents(a, 900);
    return { rig, a, b };
  }

  it("closing for good clears everything about one panel and leaves the others", () => {
    const { rig, a, b } = everything();
    rig.views.openDialog(A, { width: 1, height: 1 });
    rig.views.close(A);
    expect(a.disposed).toBe(true);
    expect(rig.mounted.has(a.view)).toBe(false);
    expect(rig.views.has(A)).toBe(false);
    expect(rig.views.byWebContents(a.webContentsId)).toBeUndefined();
    expect(rig.views.isPlaced(A)).toBe(false);
    expect(rig.views.isAwaiting(A)).toBe(false);
    expect(rig.views.takeLaunch(A)).toBeUndefined();
    expect(rig.views.takeWelcome(A)).toBe(true);
    expect(rig.views.openedFrom(A)).toBeUndefined();
    expect(rig.views.isKept(A)).toBe(false);
    expect(rig.views.dialog).toBeNull();
    expect(rig.calls).toEqual(expect.arrayContaining(["releasing " + A + " true", "dialogClosed"]));
    expect(b.disposed).toBe(false);
    expect(rig.views.has(B)).toBe(true);
    expect(rig.views.isPlaced(B)).toBe(true);
    expect(rig.views.isAwaiting(B)).toBe(true);
    expect(rig.views.takeLaunch(B)).toEqual({ reason: "add" });
    expect(rig.views.takeWelcome(B)).toBe(false);
    expect(rig.views.openedFrom(B)).toEqual({ instanceId: C, background: true });
    expect(rig.views.isKept(B)).toBe(true);
  });

  it("keeps a panel for the overlays and with its game apart: letting go of one leaves the other", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.keepRunning(A);
    rig.views.keepRunning(A, "game");
    expect(rig.views.keptIds()).toEqual([A]);
    expect(rig.views.keptIds("game")).toEqual([A]);
    rig.views.stopKeeping(A);
    expect(rig.views.keptIds()).toEqual([]);
    expect(rig.views.isKept(A)).toBe(true);
    expect(rig.views.isKept(A, "overlay")).toBe(false);
    // Still kept with its game: leaving the workspace leaves it running, out of sight but not paused.
    rig.views.closeAll();
    expect(rig.views.has(A)).toBe(true);
    rig.views.layOut(A);
    expect(a.suspended).toBe(false);
    // Also while Tavora's window is minimized: the user is playing.
    rig.world.hidden = true;
    rig.views.applyBounds();
    expect(a.suspended).toBe(false);
    rig.views.stopKeeping(A, "game");
    rig.views.applyBounds();
    expect(a.suspended).toBe(true);
    expect(rig.views.isKept(A)).toBe(false);
    rig.views.close(A);
    expect(rig.views.keptIds("game")).toEqual([]);
  });

  it("lets go of a kept panel's view only once nothing holds it: no reason left, its workspace not shown, not over the game", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.add(B);
    rig.add(C);
    for (const instanceId of [A, B, C]) rig.views.keepRunning(instanceId, "game");
    rig.views.keepRunning(A);
    rig.world.away = new Set([A, C]);
    // Still kept for the overlays.
    rig.views.letGo(A, "game");
    expect(rig.views.has(A)).toBe(true);
    // Its workspace is shown: it stays in its slot.
    rig.views.letGo(B, "game");
    expect(rig.views.has(B)).toBe(true);
    expect(rig.views.isKept(B)).toBe(false);
    // Over the game: it stays with the layer, and goes when it comes back to a workspace that isn't shown.
    const lent = rig.lend(C);
    rig.views.letGo(C, "game");
    expect(rig.views.has(C)).toBe(true);
    lent.end();
    expect(rig.views.has(C)).toBe(false);
    // Nothing holds it any more.
    rig.views.letGo(A);
    expect(rig.views.has(A)).toBe(false);
    expect(rig.calls).toContain(`releasing ${A} false`);
  });

  it("closing a panel nobody built a view for still forgets its state", () => {
    const rig = panelViewsRig();
    rig.views.setAwaiting(A);
    rig.views.keepRunning(A);
    rig.views.close(A);
    expect(rig.views.isAwaiting(A)).toBe(false);
    expect(rig.views.isKept(A)).toBe(false);
    expect(rig.calls).toContain(`releasing ${A} true`);
  });

  it("tells the host once the last view of a module goes, closed or released", () => {
    const rig = panelViewsRig();
    rig.add(A, "module", "one");
    rig.add(B, "module", "one");
    rig.add(C, "module", "two");
    rig.views.close(A);
    expect(rig.calls.filter((call) => call.startsWith("moduleGone"))).toEqual([]);
    rig.views.release(B);
    rig.views.close(id(4)); // never had a view
    expect(rig.calls.filter((call) => call.startsWith("moduleGone"))).toEqual(["moduleGone one"]);
    rig.views.closeAll();
    expect(rig.calls.filter((call) => call.startsWith("moduleGone"))).toEqual(["moduleGone one", "moduleGone two"]);
  });

  it("releasing only takes the view away: place, waiting and keeping stay for its workspace", () => {
    const { rig, a } = everything();
    rig.views.release(A);
    expect(a.disposed).toBe(true);
    expect(rig.views.has(A)).toBe(false);
    expect(rig.views.isPlaced(A)).toBe(true);
    expect(rig.views.isAwaiting(A)).toBe(true);
    expect(rig.views.isKept(A)).toBe(true);
    expect(rig.calls).toContain(`releasing ${A} false`);
    expect(rig.calls).not.toContain(`revoked ${A}`);
  });

  it("restarting ends what the page ran but keeps the place, so the view made next shows where the panel was", () => {
    const { rig, a } = everything();
    rig.views.restart(A);
    expect(a.disposed).toBe(true);
    expect(rig.views.has(A)).toBe(false);
    // Ends like a close: its questions and live state go, and its waiting, launch and welcome.
    expect(rig.calls).toContain(`releasing ${A} true`);
    expect(rig.views.isAwaiting(A)).toBe(false);
    expect(rig.views.takeLaunch(A)).toBeUndefined();
    expect(rig.views.takeWelcome(A)).toBe(true);
    // Keeps its place: no new bounds come from the host UI, as nothing changed there.
    expect(rig.views.isPlaced(A)).toBe(true);
    expect(rig.views.openedFrom(A)).toEqual({ instanceId: C, background: true });
    expect(rig.views.isKept(A)).toBe(true);
    const next = rig.add(A);
    rig.views.applyBounds();
    expect(next.bounds).toMatchObject({ width: 400, height: 300 });
    expect(next.visible).toBe(true);
    expect(next.suspended).toBe(false);
  });

  it("restarting a panel lent to the in-game layer takes it back from there", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.lend(A);
    rig.views.restart(A);
    expect(rig.calls).toContain(`revoked ${A}`);
  });

  it("releasing a view drops an Add its page never asked for, so a view made later starts as a restore", () => {
    const { rig, b } = everything();
    rig.views.release(A);
    expect(rig.views.takeLaunch(A)).toBeUndefined();
    expect(rig.views.takeWelcome(A)).toBe(true);
    // A panel opened by another one keeps what it was opened on.
    rig.views.setLaunch(B, { reason: "open", content: null });
    rig.views.release(B);
    expect(b.disposed).toBe(true);
    expect(rig.views.takeLaunch(B)).toEqual({ reason: "open", content: null });
  });

  it("closing all keeps panels lent to the layer or kept for overlays, and forgets places", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    const c = rig.add(C);
    rig.lend(A);
    rig.views.keepRunning(B);
    rig.views.place([place(A), place(B), place(C)]);
    rig.views.openDialog(C, { width: 1, height: 1 });
    rig.views.closeAll();
    expect(a.disposed || b.disposed).toBe(false);
    expect(c.disposed).toBe(true);
    expect(rig.views.ids().sort()).toEqual([A, B]);
    expect(rig.views.placedCount()).toBe(0);
    expect(rig.views.dialog).toBeNull();
  });

  it("disposing all drops every view with the window", () => {
    const { rig, a, b } = everything();
    rig.views.disposeAll();
    expect(a.disposed && b.disposed).toBe(true);
    expect(rig.views.size).toBe(0);
    expect(rig.views.byWebContents(900)).toBeUndefined();
  });

  it("unbinds contents only if they still belong to the same view", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    rig.views.bindContents(a, 7);
    rig.views.unbindContents(b, 7);
    expect(rig.views.byWebContents(7)).toBe(a);
    rig.views.unbindContents(a, 7);
    expect(rig.views.byWebContents(7)).toBeUndefined();
  });
});

describe("open", () => {
  it("starts a view hidden and paused, then lets it join the window", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    expect(a.visible).toBe(false);
    expect(a.suspended).toBe(true);
    expect(rig.mounted.has(a.view)).toBe(true);
  });

  it("builds nothing when the panel already has a view", () => {
    const rig = panelViewsRig();
    const first = rig.add(A);
    const make = vi.fn();
    expect(rig.views.open({ instanceId: A, moduleId: "m" }, make)).toBeUndefined();
    expect(make).not.toHaveBeenCalled();
    expect(rig.views.get(A)).toBe(first);
  });

  it("keeps a launch reason until the page first asks", () => {
    const rig = panelViewsRig();
    rig.views.setLaunch(A, { reason: "open", content: null });
    expect(rig.views.takeLaunch(A)).toEqual({ reason: "open", content: null });
    expect(rig.views.takeLaunch(A)).toBeUndefined();
    expect(rig.views.stopAwaiting(A)).toBe(false);
  });
});

describe("snapshot", () => {
  it("describes every panel, the opening, the overlay and the dialog", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    // Only a module panel can be lent to the in-game layer.
    rig.add(B);
    rig.lend(B);
    rig.add(D, "browser");
    rig.views.setAwaiting(C);
    rig.views.setOpenedFrom(B, { instanceId: A, background: false });
    rig.views.keepRunning(A);
    a.firstDrawn = false;
    rig.views.place([place(A)]);
    rig.views.startOpening(5000, "x");
    expect(rig.views.snapshot()).toEqual({
      opening: true,
      overlay: false,
      dialog: null,
      panels: {
        [A]: { kind: "module", status: "ready", revealed: true, firstDrawn: false, lent: false, placed: true, awaiting: false, kept: true, openedFrom: null },
        [B]: { kind: "module", status: "ready", revealed: true, firstDrawn: true, lent: true, placed: false, awaiting: false, kept: false, openedFrom: { instanceId: A, background: false } },
        [D]: { kind: "browser", status: "ready", revealed: true, firstDrawn: true, lent: false, placed: false, awaiting: false, kept: false, openedFrom: null },
      },
    });
    rig.views.endOpening(false);
    await rig.views.freeze(true);
    expect(rig.views.snapshot().overlay).toBe(true);
    expect(rig.views.snapshot().opening).toBe(false);
  });
});

describe("a welcome", () => {
  it("is for each panel just added, unless it came with another one from the same click, and is asked once", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.add(B);
    rig.views.withholdWelcome(B);
    expect(rig.views.takeWelcome(A)).toBe(true);
    expect(rig.views.takeWelcome(B)).toBe(false);
    // Asked again (a reload), the host answers by the launch reason, which is no longer add.
    expect(rig.views.takeWelcome(B)).toBe(true);
  });
});

describe("a panel's own dialog: tooltips and menus", () => {
  const PICTURE = "data:image/jpeg;base64,AAAA";
  const KEY = dialogPictureKey(A);
  const DIALOG = { x: 100, y: 50, width: 600, height: 400 };

  /** A in its dialog with the frame on screen, B in its slot under it, as the host UI leaves them. */
  async function inDialog() {
    const rig = panelViewsRig();
    const adapter = rig.add(A);
    const other = rig.add(B);
    rig.views.place([place(A), place(B, 400)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    await rig.views.freeze(true);
    rig.views.placeDialog(DIALOG);
    rig.views.showDialog(A);
    await vi.advanceTimersByTimeAsync(0);
    return { rig, adapter, other };
  }

  it("lets the panel in its dialog show a tooltip, placed by the dialog", async () => {
    const { rig } = await inDialog();
    expect(rig.views.isShowing(A)).toBe(true);
    expect(rig.views.placeOf(A)).toEqual(DIALOG);
    expect(rig.views.isShowing(B)).toBe(false);
    expect(rig.views.placeOf(B)).toBe(rig.views.boundsOf(B));
  });

  it("takes that back while a page dialog lies over it, and closes its tooltip", async () => {
    const placing = vi.fn();
    const rig = panelViewsRig({ placing });
    rig.add(A);
    rig.views.place([place(A)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    await rig.views.freeze(true);
    rig.views.placeDialog(DIALOG);
    rig.views.showDialog(A);
    placing.mockClear();
    rig.views.coverDialog(true);
    expect(placing).toHaveBeenCalled();
    expect(rig.views.isShowing(A)).toBe(false);
    expect(rig.views.mayShowMenu(A)).toBe(false);
    expect(rig.views.placeOf(A)).toBe(rig.views.boundsOf(A));
  });

  it("allows a menu only for the panel in the dialog", async () => {
    const { rig } = await inDialog();
    expect(rig.views.mayShowMenu(A)).toBe(true);
    expect(rig.views.mayShowMenu(B)).toBe(false);
  });

  it("steps the view aside behind its picture for the menu, and brings it back", async () => {
    const { rig, adapter } = await inDialog();
    expect(adapter.visible).toBe(true);
    await rig.views.openDialogMenu(A);
    expect(adapter.visible).toBe(false);
    expect(rig.frozen.at(-1)![KEY]).toBe(PICTURE);
    expect(rig.awaited.at(-1)).toEqual([KEY]);
    expect(rig.views.isShowing(A)).toBe(false);
    rig.views.closeDialogMenu();
    expect(adapter.visible).toBe(true);
    // The picture stays under the page until it has drawn.
    expect(rig.frozen.at(-1)![KEY]).toBe(PICTURE);
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    expect(rig.frozen.at(-1)![KEY]).toBeUndefined();
    expect(rig.views.isShowing(A)).toBe(true);
  });

  it("steps aside without a picture too, so the menu is never under the view", async () => {
    const { rig, adapter } = await inDialog();
    adapter.image = null;
    await rig.views.openDialogMenu(A);
    expect(adapter.visible).toBe(false);
    expect(rig.frozen.at(-1)?.[KEY]).toBeUndefined();
  });

  it("leaves the view in sight when the menu closed before its picture was there", async () => {
    const { rig, adapter } = await inDialog();
    let finish: (image: string) => void = () => undefined;
    adapter.capture = () => new Promise((resolve) => (finish = resolve));
    const opening = rig.views.openDialogMenu(A);
    rig.views.closeDialogMenu();
    finish(PICTURE);
    await opening;
    expect(adapter.visible).toBe(true);
    expect(rig.frozen.at(-1)?.[KEY]).toBeUndefined();
  });

  it("drops the picture at once when the dialog closes during the menu", async () => {
    const { rig } = await inDialog();
    await rig.views.openDialogMenu(A);
    rig.views.closeDialog();
    expect(rig.frozen.at(-1)?.[KEY]).toBeUndefined();
    expect(rig.views.isShowing(A)).toBe(false);
  });
});

describe("a panel that goes during a host menu", () => {
  it("keeps nothing of a panel closed while its picture was taken", async () => {
    const rig = panelViewsRig();
    const adapter = rig.add(A);
    rig.views.place([place(A)]);
    let finish: (image: string) => void = () => undefined;
    adapter.capture = () => new Promise((resolve) => (finish = resolve));
    const freezing = rig.views.freeze(true, [A], 1);
    await vi.advanceTimersByTimeAsync(0);
    rig.views.close(A);
    adapter.visible = true;
    finish("data:image/jpeg;base64,AAAA");
    await freezing;
    expect(adapter.visible).toBe(true);
    expect(rig.frozen.at(-1)?.[A]).toBeUndefined();
    expect(rig.calls).toContain("overlayReady 1");
  });

  it("steps the new view of a panel restarted while its picture was taken aside until the menu closes", async () => {
    const rig = panelViewsRig();
    const first = rig.add(A);
    rig.views.place([place(A)]);
    let finish: (image: string) => void = () => undefined;
    first.capture = () => new Promise((resolve) => (finish = resolve));
    const freezing = rig.views.freeze(true, [A], 1);
    await vi.advanceTimersByTimeAsync(0);
    rig.views.restart(A);
    const second = rig.add(A);
    rig.views.applyBounds();
    expect(second.visible).toBe(true);
    finish("data:image/jpeg;base64,AAAA");
    await freezing;
    expect(second.visible).toBe(false);
    expect(rig.frozen.at(-1)?.[A]).toBeUndefined();
    const closing = rig.views.freeze(false);
    await vi.advanceTimersByTimeAsync(1000);
    await closing;
    expect(second.visible).toBe(true);
  });
});

describe("popups over panels as one state", () => {
  /** The overlay and every panel's step, as the shared state has them (shared/popups-over-panels.ts). */
  const steps = (rig: ReturnType<typeof panelViewsRig>) => {
    const { overlay, panels } = rig.views.popupsOverPanels;
    return { overlay: overlay.status === "partial" ? [...overlay.panels] : overlay.status, panels: Object.fromEntries([...panels].map(([instanceId, panel]) => [instanceId, panel.step])) };
  };

  it("goes from closed to a menu over some panels, to a dialog over all, and back with each picture settling", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.add(B);
    rig.add(C);
    rig.views.place([place(A), place(B, 400), place(C, 0, 300)]);
    expect(steps(rig)).toEqual({ overlay: "closed", panels: {} });
    let releaseA: (image: string) => void = () => undefined;
    a.capture = () => new Promise((resolve) => (releaseA = resolve));
    const menu = rig.views.freeze(true, [A], 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(steps(rig)).toEqual({ overlay: [A], panels: { [A]: "picturing" } });
    releaseA("data:a");
    await menu;
    expect(steps(rig)).toEqual({ overlay: [A], panels: { [A]: "out" } });
    await rig.views.freeze(true, undefined, 2);
    expect(steps(rig)).toEqual({ overlay: "all", panels: { [A]: "out", [B]: "out", [C]: "out" } });
    let settleA: () => void = () => undefined;
    a.settled = new Promise((resolve) => (settleA = resolve));
    const closing = rig.views.freeze(false);
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    expect(steps(rig)).toEqual({ overlay: "closed", panels: { [A]: "settling" } });
    settleA();
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    await closing;
    expect(steps(rig)).toEqual({ overlay: "closed", panels: {} });
  });

  it("shows a panel back from another tab on its last picture without a step of its own, and lets go of it once it has drawn", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    a.capture = () => Promise.resolve("data:last");
    rig.views.place([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.frozen.at(-1)?.[A]).toBeDefined();
    let settle: () => void = () => undefined;
    a.settled = new Promise((resolve) => (settle = resolve));
    rig.views.place([place(A)]);
    // The picture lies under it, and the shared state has nothing for it: no menu or dialog is over it.
    expect(steps(rig).panels).toEqual({});
    settle();
    await vi.advanceTimersByTimeAsync(FROZEN_GONE_MS);
    expect(steps(rig).panels).toEqual({});
    expect(rig.frozen.at(-1)).toEqual({});
  });

  it("keeps nothing of a panel that goes while out", async () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.views.place([place(A)]);
    await rig.views.freeze(true, undefined, 1);
    expect(steps(rig).panels).toEqual({ [A]: "out" });
    rig.views.close(A);
    expect(steps(rig)).toEqual({ overlay: "all", panels: {} });
  });
});
