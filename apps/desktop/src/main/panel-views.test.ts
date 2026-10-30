import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampRect, FROZEN_GONE_MS } from "./panel-views";
import { panelViewsRig } from "./panel-views.test-helper";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1);
const B = id(2);
const C = id(3);
const place = (instanceId: string, x = 0, y = 0, width = 400, height = 300, extra: object = {}) => ({ instanceId, x, y, width, height, ...extra });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("bounds", () => {
  it("clamps a place to the window and rounds it", () => {
    expect(clampRect({ x: 10.4, y: 20.6, width: 5000, height: 5000 }, { width: 1000, height: 800 })).toEqual({ x: 10, y: 21, width: 990, height: 779 });
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

  it("keeps a panel running for the overlays going when it is out of sight, unless the window is hidden", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.keepRunning(A);
    rig.views.applyBounds();
    expect(a.visible).toBe(false);
    expect(a.suspended).toBe(false);
    rig.world.hidden = true;
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
    expect(lease.view).toBe(a);
    expect(rig.mounted.has(a.view)).toBe(false);
    expect(rig.views.isLent(A)).toBe(true);
    expect(rig.views.isLentContents(a.webContentsId)).toBe(true);
    // Lent once: nobody else can take it, nothing is lent that has no view.
    expect(rig.views.lend(A, () => {})).toBeUndefined();
    expect(rig.views.lend(B, () => {})).toBeUndefined();
    lease.return();
    expect(rig.views.isLent(A)).toBe(false);
    expect(rig.views.isLentContents(a.webContentsId)).toBe(false);
    expect(rig.mounted.has(a.view)).toBe(true);
    expect(a.visible).toBe(true);
    expect(rig.calls).toContain(`returned ${A}`);
    // Returned twice, nothing more happens.
    rig.calls.length = 0;
    lease.return();
    expect(rig.calls).toEqual([]);
  });

  it("lets go of a returned panel whose workspace is not shown any more", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A)]);
    const lease = rig.lend(A);
    rig.world.away.add(A);
    lease.return();
    expect(rig.views.has(A)).toBe(false);
    expect(a.disposed).toBe(true);
    expect(rig.calls).toContain(`releasing ${A} false`);
    expect(rig.calls).not.toContain(`returned ${A}`);
    // Its place stays for when its workspace comes back.
    expect(rig.views.isPlaced(A)).toBe(true);
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
    lease.return();
    expect(rig.mounted.has(a.view)).toBe(false);
    expect(rig.calls).not.toContain(`returned ${A}`);
  });

  it("only releasing a lent panel does not tell the layer", () => {
    const rig = panelViewsRig();
    rig.add(A);
    rig.lend(A);
    rig.views.release(A);
    expect(rig.calls).not.toContain(`revoked ${A}`);
  });

  it("disposing everything while lent forgets the loans and returns nothing to a gone window", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const lease = rig.lend(A);
    rig.views.disposeAll();
    expect(a.disposed).toBe(true);
    expect(rig.views.isLent(A)).toBe(false);
    lease.return();
    expect(rig.mounted.has(a.view)).toBe(false);
    expect(rig.calls).not.toContain(`revoked ${A}`);
  });

  it("does not put a returned panel back into a window that is gone", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const lease = rig.lend(A);
    rig.world.gone = true;
    lease.return();
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
    expect(rig.frozen).toEqual([{}]);
    expect(lent.image).not.toBeNull();
  });

  it("gives up on a picture that takes too long", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    a.capture = () => new Promise(() => undefined);
    rig.views.place([place(A)]);
    const freezing = rig.views.freeze(true);
    await vi.advanceTimersByTimeAsync(250);
    await freezing;
    expect(rig.frozen).toEqual([{}]);
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
    lease.return();
    expect(rig.views.openDialog(A, { width: 600, height: 400 })).toBe(true);
    expect(rig.views.openDialog(A, { width: 600, height: 400 })).toBe(false);
  });

  it("puts the panel in its frame above the dimmed app while the others step aside", async () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    const b = rig.add(B);
    rig.views.place([place(A), place(B, 400)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
    expect(a.inDialog).toBe(true);
    expect(rig.views.snapshot().dialog).toEqual({ instanceId: A, width: 600, height: 400, placed: false });
    await rig.views.freeze(true);
    rig.views.placeDialog({ x: 100, y: 50, width: 600.4, height: 400 });
    expect(a.bounds).toEqual({ x: 100, y: 50, width: 600, height: 400 });
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);
    expect(rig.views.inDialog(A)).toBe(true);
    expect(rig.views.snapshot().dialog?.placed).toBe(true);
  });

  it("ignores a bad frame, and closing puts the panel back in its slot", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.views.place([place(A, 10, 10, 300, 200)]);
    rig.views.openDialog(A, { width: 600, height: 400 });
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

  it("opens another dialog by closing the one before", () => {
    const rig = panelViewsRig();
    const a = rig.add(A);
    rig.add(B);
    rig.views.place([place(A), place(B, 400)]);
    rig.views.openDialog(A, { width: 1, height: 1 });
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
    expect(rig.views.openedFrom(A)).toBeUndefined();
    expect(rig.views.isKept(A)).toBe(false);
    expect(rig.views.dialog).toBeNull();
    expect(rig.calls).toEqual(expect.arrayContaining(["releasing " + A + " true", "dialogClosed"]));
    expect(b.disposed).toBe(false);
    expect(rig.views.has(B)).toBe(true);
    expect(rig.views.isPlaced(B)).toBe(true);
    expect(rig.views.isAwaiting(B)).toBe(true);
    expect(rig.views.takeLaunch(B)).toEqual({ reason: "add" });
    expect(rig.views.openedFrom(B)).toEqual({ instanceId: C, background: true });
    expect(rig.views.isKept(B)).toBe(true);
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
    rig.add(B, "browser");
    rig.lend(B);
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
        [B]: { kind: "browser", status: "ready", revealed: true, firstDrawn: true, lent: true, placed: false, awaiting: false, kept: false, openedFrom: { instanceId: A, background: false } },
      },
    });
    rig.views.endOpening(false);
    await rig.views.freeze(true);
    expect(rig.views.snapshot().overlay).toBe(true);
    expect(rig.views.snapshot().opening).toBe(false);
  });
});
