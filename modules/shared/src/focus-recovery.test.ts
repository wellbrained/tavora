// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createFocusRecovery, type FocusRecovery } from "./focus-recovery";

/** Lets the page's MutationObserver run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const stops: FocusRecovery[] = [];
afterEach(() => {
  stops.splice(0).forEach((recovery) => recovery.stop());
  document.body.innerHTML = "";
});

/** A list of rows like a to-do: a title button, a trash button. */
function makeList(keys: string[], { empty = false } = {}) {
  const list = document.createElement("ul");
  for (const key of keys) list.append(makeRow(key));
  if (empty) {
    const state = document.createElement("div");
    state.setAttribute("data-focus-empty", "");
    state.innerHTML = `<p>Nothing here</p><input data-testid="add" />`;
    list.append(state);
  }
  document.body.append(list);
  const recovery = createFocusRecovery(() => list);
  stops.push(recovery);
  return { list, recovery };
}

function makeRow(key: string) {
  const row = document.createElement("li");
  row.setAttribute("data-focus-row", key);
  row.innerHTML = `<button data-testid="title-${key}">${key}</button><button data-testid="trash-${key}">x</button>`;
  return row;
}

const byTestid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const rowOf = (key: string) => document.querySelector<HTMLElement>(`[data-focus-row="${key}"]`)!;
const active = () => (document.activeElement as HTMLElement | null)?.dataset.testid ?? document.activeElement?.tagName;

describe("useFocusRecovery", () => {
  it("moves to the same spot in the next row when the focused row is deleted", async () => {
    makeList(["a", "b", "c"]);
    byTestid("trash-b").focus();
    rowOf("b").remove();
    await settle();
    expect(active()).toBe("trash-c");
  });

  it("moves to the row before when the last row goes", async () => {
    makeList(["a", "b", "c"]);
    byTestid("title-c").focus();
    rowOf("c").remove();
    await settle();
    expect(active()).toBe("title-b");
  });

  it("moves to the empty state's first control when no row is left", async () => {
    makeList(["a"], { empty: true });
    byTestid("title-a").focus();
    rowOf("a").remove();
    await settle();
    expect(active()).toBe("add");
  });

  it("moves to the list itself when there is no empty state, and lets go of its tabindex afterwards", async () => {
    const { list } = makeList(["a"]);
    byTestid("title-a").focus();
    rowOf("a").remove();
    await settle();
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("tabindex")).toBe("-1");
    list.blur();
    expect(list.hasAttribute("tabindex")).toBe(false);
  });

  it("moves to the row before a control between rows that goes (a field for a new row)", async () => {
    const { list } = makeList(["a", "b", "c"]);
    const draft = document.createElement("li");
    draft.innerHTML = `<input data-testid="draft" />`;
    list.insertBefore(draft, rowOf("c"));
    byTestid("draft").focus();
    draft.remove();
    await settle();
    expect(active()).toBe("title-b");
  });

  it("moves to the list when the empty state has nothing to press", async () => {
    const { list } = makeList(["a"]);
    const state = document.createElement("p");
    state.setAttribute("data-focus-empty", "");
    list.append(state);
    byTestid("title-a").focus();
    rowOf("a").remove();
    await settle();
    expect(document.activeElement).toBe(list);
  });

  it("lands on the row's target when the next row has other controls", async () => {
    const { list } = makeList(["a", "b"]);
    const odd = document.createElement("li");
    odd.setAttribute("data-focus-row", "c");
    odd.innerHTML = `<button data-testid="fold-c">></button><button data-testid="title-c" data-focus-target>c</button><button data-testid="trash-c">x</button>`;
    list.append(odd);
    byTestid("trash-b").focus();
    rowOf("b").remove();
    await settle();
    expect(active()).toBe("title-c");
  });

  it("skips rows that went at the same time", async () => {
    makeList(["a", "b", "c", "d"]);
    byTestid("title-b").focus();
    rowOf("b").remove();
    rowOf("c").remove();
    await settle();
    expect(active()).toBe("title-d");
  });

  it("moves at once from a row that is leaving (inert while it folds away)", async () => {
    makeList(["a", "b"]);
    byTestid("title-a").focus();
    // leaveRow sets `inert`, which the browser reflects as the attribute (jsdom does not).
    rowOf("a").setAttribute("inert", "");
    await settle();
    expect(active()).toBe("title-b");
  });

  it("keeps the focus on a row that was only moved", async () => {
    const { list } = makeList(["a", "b", "c"]);
    byTestid("trash-c").focus();
    list.insertBefore(rowOf("c"), rowOf("a"));
    await settle();
    expect(active()).toBe("trash-c");
  });

  it("finds a row drawn anew by its key", async () => {
    const { list } = makeList(["a", "b"]);
    byTestid("trash-a").focus();
    const fresh = makeRow("a");
    rowOf("a").remove();
    list.prepend(fresh);
    await settle();
    expect(document.activeElement).toBe(fresh.querySelector("[data-testid='trash-a']"));
  });

  it("waits while a menu or dialog has the focus, then recovers once it closes", async () => {
    makeList(["a", "b"]);
    byTestid("trash-a").focus();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<button data-testid="delete">Delete</button>`;
    document.body.append(menu);
    byTestid("delete").focus();
    rowOf("a").remove();
    await settle();
    expect(active()).toBe("delete");
    menu.remove();
    await settle();
    expect(active()).toBe("trash-b");
  });

  it("waits while the list is behind a dialog (inert), then recovers once it is back", async () => {
    const { list } = makeList(["a", "b"]);
    byTestid("trash-a").focus();
    list.setAttribute("inert", "");
    rowOf("a").remove();
    await settle();
    expect(document.activeElement).toBe(document.body);
    list.removeAttribute("inert");
    await settle();
    expect(active()).toBe("trash-b");
  });

  it("never takes the focus from something outside the list", async () => {
    makeList(["a", "b"]);
    const field = document.createElement("input");
    field.dataset.testid = "outside";
    document.body.append(field);
    byTestid("title-a").focus();
    field.focus();
    rowOf("a").remove();
    await settle();
    expect(active()).toBe("outside");
  });

  it("lets go of the row after a press outside it, so a later change does not pull the focus back", async () => {
    const { list } = makeList(["a", "b"]);
    byTestid("title-a").focus();
    list.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    byTestid("title-a").blur();
    rowOf("b").remove();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves the outer list alone when a nested list moves the focus", async () => {
    const outer = document.createElement("div");
    const group = document.createElement("section");
    group.setAttribute("data-focus-row", "g1");
    group.innerHTML = `<button data-testid="menu-g1">…</button>`;
    const inner = document.createElement("ul");
    inner.append(makeRow("a"), makeRow("b"));
    group.append(inner);
    const other = document.createElement("section");
    other.setAttribute("data-focus-row", "g2");
    other.innerHTML = `<button data-testid="menu-g2">…</button>`;
    outer.append(group, other);
    document.body.append(outer);
    stops.push(createFocusRecovery(() => outer), createFocusRecovery(() => inner));

    byTestid("title-a").focus();
    rowOf("a").remove();
    await settle();
    expect(active()).toBe("title-b");

    byTestid("menu-g1").focus();
    group.remove();
    await settle();
    expect(active()).toBe("menu-g2");
  });

  describe("restore", () => {
    it("gives a row back the focus when Undo brings it back while the focus is in the list", async () => {
      const { list, recovery } = makeList(["a", "b"]);
      byTestid("title-a").focus();
      rowOf("a").remove();
      await settle();
      expect(active()).toBe("title-b");
      recovery.restore("a");
      list.prepend(makeRow("a"));
      await settle();
      expect(active()).toBe("title-a");
    });

    it("takes the focus from the Undo toast, which is going away", async () => {
      const { list, recovery } = makeList(["b"]);
      const toaster = document.createElement("div");
      toaster.dataset.slot = "toaster-host";
      toaster.innerHTML = `<button data-testid="undo">Undo</button>`;
      document.body.append(toaster);
      byTestid("undo").focus();
      recovery.restore("a");
      list.prepend(makeRow("a"));
      await settle();
      expect(active()).toBe("title-a");
    });

    it("does nothing when the user went on to something else", async () => {
      const { list, recovery } = makeList(["b"]);
      const field = document.createElement("input");
      field.dataset.testid = "outside";
      document.body.append(field);
      recovery.restore("a");
      field.focus();
      list.prepend(makeRow("a"));
      await settle();
      expect(active()).toBe("outside");
    });
  });

  it("stops listening once stopped", async () => {
    const { recovery } = makeList(["a", "b"]);
    recovery.stop();
    byTestid("title-a").focus();
    rowOf("a").remove();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
});
