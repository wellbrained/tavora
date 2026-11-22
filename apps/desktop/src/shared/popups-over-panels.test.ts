import { describe, expect, it } from "vitest";
import { isAsked, isOpen, isSteppedAside, NO_POPUPS, overlayPictures, panelStep, popupsStep, settlingAfterOverlay, type PopupsEvent, type PopupsOverPanels } from "./popups-over-panels";

// Pictures are plain strings here; the host's are objects told apart by identity.
type State = PopupsOverPanels<string>;

/** Runs the events from no overlay and gives the state after them. */
function run(events: PopupsEvent<string>[], from: State = NO_POPUPS): State {
  return events.reduce(popupsStep<string>, from);
}

/** The overlay and every panel's step as text, to compare in a table. */
function seen(state: State): string {
  const overlay = state.overlay.status === "partial" ? `partial(${[...state.overlay.panels].join(",")})` : state.overlay.status;
  const panels = [...state.panels].map(([id, panel]) => `${id}:${panel.step}${panel.step === "live" ? "" : `[${panel.picture ?? "-"}${panel.step === "settling" ? `,${panel.after}` : ""}]`}`);
  return [overlay, ...panels].join(" ");
}

const open: PopupsEvent<string> = { type: "open" };
const close: PopupsEvent<string> = { type: "close" };
const ask = (...only: string[]): PopupsEvent<string> => ({ type: "ask", only });
const askAll: PopupsEvent<string> = { type: "ask" };
const picturing = (...ids: string[]): PopupsEvent<string> => ({ type: "picturing", ids });
const pictured = (id: string, picture: string): PopupsEvent<string> => ({ type: "pictured", id, picture });
const out = (id: string): PopupsEvent<string> => ({ type: "out", id });
const stay = (id: string): PopupsEvent<string> => ({ type: "stay", id });
const back = (id: string, picture: string): PopupsEvent<string> => ({ type: "back", id, picture });
const settled = (id: string, picture: string): PopupsEvent<string> => ({ type: "settled", id, picture });
const drop = (id: string, picture: string): PopupsEvent<string> => ({ type: "drop", id, picture });
const gone = (id: string): PopupsEvent<string> => ({ type: "gone", id });

describe("popups over panels, step by step", () => {
  const table: [string, PopupsEvent<string>[], string][] = [
    ["nothing open", [], "closed"],
    ["a menu opens over no panel yet", [open], "partial()"],
    ["a menu asks for the panels it lies over, then for more", [open, ask("a"), ask("b", "a")], "partial(a,b)"],
    ["a request opens the overlay by itself", [ask("a")], "partial(a)"],
    ["a dialog: every panel", [askAll], "all"],
    ["a menu then a dialog: every panel, and a later menu request adds nothing", [ask("a"), askAll, ask("b")], "all"],
    ["a panel's picture is taken, it stays in sight until it is on screen", [ask("a"), picturing("a"), pictured("a", "A1")], "partial(a) a:picturing[A1]"],
    ["then it is out behind it", [ask("a"), picturing("a"), pictured("a", "A1"), out("a")], "partial(a) a:out[A1]"],
    ["out with no picture under a dialog", [askAll, out("a")], "all a:out[-]"],
    ["a picture that came to nothing under a menu leaves it live", [ask("a"), picturing("a"), stay("a")], "partial(a)"],
    ["closing: a panel out on a picture settles on it, one with none is live", [askAll, picturing("a"), pictured("a", "A1"), out("a"), out("b"), close], "closed a:settling[A1,overlay]"],
    ["closing while a picture is still taken: it settles on it all the same", [ask("a"), picturing("a"), pictured("a", "A1"), close], "closed a:settling[A1,overlay]"],
    ["it is live once it has drawn on that picture", [askAll, picturing("a"), pictured("a", "A1"), out("a"), close, settled("a", "A1")], "closed"],
    ["back from another tab, it settles on its last picture until it has drawn", [back("a", "S1")], "closed a:settling[S1,away]"],
    ["and is live once it has", [back("a", "S1"), settled("a", "S1")], "closed"],
    ["leaving again before that, it no longer settles on it", [back("a", "S1"), drop("a", "S1")], "closed"],
    ["a gone panel keeps nothing", [askAll, picturing("a"), pictured("a", "A1"), out("a"), gone("a")], "all"],
  ];
  it.each(table)("%s", (_name, events, expected) => {
    expect(seen(run(events))).toBe(expected);
  });

  it("counts each overlay opened and closed, and nothing else", () => {
    expect(run([open]).session).toBe(1);
    expect(run([open, ask("a"), askAll, open]).session).toBe(1);
    expect(run([open, close]).session).toBe(2);
    expect(run([open, close, close, ask("a")]).session).toBe(3);
  });

  it("gives back the same state when nothing changes", () => {
    const menu = run([ask("a"), picturing("a"), pictured("a", "A1"), out("a")]);
    for (const event of [open, ask("a"), picturing("a"), out("a"), stay("a"), back("a", "S1"), settled("a", "A0"), drop("a", "A1"), gone("z")]) expect(popupsStep(menu, event)).toBe(menu);
    expect(popupsStep(NO_POPUPS, close)).toBe(NO_POPUPS);
  });
});

describe("an overlay over pictures still settling", () => {
  it("leaves a newer overlay's picture alone when an older close's panel settles", () => {
    const reopened = run([askAll, picturing("a"), pictured("a", "A1"), out("a"), close, askAll, picturing("a"), pictured("a", "A2")]);
    expect(seen(reopened)).toBe("all a:picturing[A2]");
    // The older close's wait ends now: A1 is no longer under the panel.
    expect(popupsStep(reopened, settled("a", "A1"))).toBe(reopened);
  });

  it("keeps the older picture under a panel pictured again until a new one comes, and settles on it if that one came to nothing", () => {
    const again = run([ask("a"), picturing("a"), pictured("a", "A1"), out("a"), close, ask("a"), picturing("a")]);
    expect(seen(again)).toBe("partial(a) a:picturing[A1]");
    expect(seen(popupsStep(again, stay("a")))).toBe("partial(a) a:settling[A1,overlay]");
  });

  it("does not take a picture from away into the overlay: the kept pictures still hold it", () => {
    const fromAway = run([back("a", "S1"), askAll, picturing("a")]);
    expect(seen(fromAway)).toBe("all a:picturing[-]");
    expect(seen(run([back("a", "S1"), askAll, out("a")]))).toBe("all a:out[-]");
    expect(overlayPictures(run([back("a", "S1")])).size).toBe(0);
  });

  it("does not let a picture from away replace one the overlay holds", () => {
    const held = run([askAll, picturing("a"), pictured("a", "A1"), out("a")]);
    expect(popupsStep(held, back("a", "S1"))).toBe(held);
    const settling = run([askAll, picturing("a"), pictured("a", "A1"), out("a"), close]);
    expect(popupsStep(settling, back("a", "S1"))).toBe(settling);
    expect(popupsStep(settling, drop("a", "A1"))).toBe(settling);
  });
});

describe("what both sides read", () => {
  it("steps a panel aside once it is out, or under a dialog unless its picture is being taken", () => {
    const menu = run([ask("a", "b"), picturing("a", "b"), out("a")]);
    expect([isSteppedAside(menu, "a"), isSteppedAside(menu, "b"), isSteppedAside(menu, "c")]).toEqual([true, false, false]);
    const dialog = run([askAll, picturing("a")]);
    expect([isSteppedAside(dialog, "a"), isSteppedAside(dialog, "b")]).toEqual([false, true]);
    expect(isSteppedAside(run([askAll, picturing("a"), out("a"), close]), "a")).toBe(false);
  });

  it("says which panels are asked and whether the overlay is open", () => {
    const menu = run([ask("a")]);
    expect([isAsked(menu.overlay, "a"), isAsked(menu.overlay, "b"), isAsked(run([askAll]).overlay, "b"), isAsked(NO_POPUPS.overlay, "a")]).toEqual([true, false, true, false]);
    expect([isOpen(NO_POPUPS), isOpen(run([open])), isOpen(run([open, close]))]).toEqual([false, true, false]);
  });

  it("lists the overlay's pictures and those settling after it", () => {
    const state = run([askAll, picturing("a", "b"), pictured("a", "A1"), out("a"), out("b"), close, back("c", "S1"), ask("d"), picturing("d"), pictured("d", "D1")]);
    expect([...overlayPictures(state)]).toEqual([
      ["a", "A1"],
      ["d", "D1"],
    ]);
    expect(settlingAfterOverlay(state)).toEqual([["a", "A1"]]);
    expect(panelStep(state, "c")).toEqual({ step: "settling", picture: "S1", after: "away" });
    expect(panelStep(state, "b")).toEqual({ step: "live" });
  });
});
