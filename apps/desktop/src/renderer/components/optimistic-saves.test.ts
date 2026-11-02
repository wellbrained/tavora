// @vitest-environment jsdom
// The call sites of the optimistic helper (modules/shared/src/optimistic.ts) where the screen is more than a switch:
// the reviews of a catalog module and the contact choice. The host is replaced by a fake whose answers the test gives
// by hand, so the order things happen in is the test's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, shallowRef, type App } from "vue";
import type { CatalogReviews, CatalogReviewsResult } from "../../shared/host-api";

const host = vi.hoisted(() => ({
  act: vi.fn(),
  api: { catalogReviews: vi.fn() },
  notSaved: vi.fn(),
  openProfile: vi.fn(),
}));
vi.mock("../host", async () => {
  const { ref } = await import("vue");
  return { ...host, dialog: ref(null) };
});
// Plain controls in place of the kit's pickers, so the test needs no popups.
vi.mock("@tavora/official-ui/components/ui/star-rating", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    StarRating: defineComponent({
      props: { modelValue: { type: Number, default: 0 }, editable: Boolean, disabled: Boolean },
      emits: ["update:modelValue"],
      setup: (props, { emit }) => () =>
        props.editable
          ? h("div", { "data-testid": "stars", "data-value": props.modelValue }, [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", disabled: props.disabled, "data-testid": `star-${n}`, onClick: () => emit("update:modelValue", n) })))
          : h("span"),
    }),
  };
});
vi.mock("@tavora/official-ui/components/ui/select", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = (tag: string) => defineComponent({ setup: (_, { slots }) => () => h(tag, slots.default?.()) });
  return {
    Select: defineComponent({
      props: { modelValue: String, disabled: Boolean },
      emits: ["update:modelValue"],
      setup: (props, { emit, slots }) => () =>
        h("div", { "data-testid": "select", "data-value": props.modelValue }, [
          ...["none", "tavora", "email"].map((kind) => h("button", { type: "button", "data-testid": `pick-${kind}`, onClick: () => emit("update:modelValue", kind) })),
          slots.default?.(),
        ]),
    }),
    SelectContent: passthrough("div"),
    SelectItem: passthrough("div"),
    SelectTrigger: passthrough("div"),
    SelectValue: passthrough("span"),
  };
});

import CatalogReviewsView from "./CatalogReviews.vue";
import ContactChoice from "./developer/ContactChoice.vue";

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Lets Vue and pending promises run. */
const settle = async () => {
  await tick();
  await tick();
};

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  host.act.mockReset();
  host.api.catalogReviews.mockReset();
  host.notSaved.mockReset();
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});

const $ = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (id: string) => {
  const element = $(id);
  if (!element) throw new Error(`no ${id}`);
  element.click();
  await settle();
};
const type = async (id: string, value: string) => {
  const element = $(id) as HTMLTextAreaElement | HTMLInputElement;
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
};
const ok = { ok: true };

// ── Reviews ───────────────────────────────────────────────────────────────

function reviews(extra: Partial<CatalogReviews> = {}): CatalogReviewsResult {
  return { status: "ok", rating: null, reviews: [], mine: null, can: "rate", installedVersion: "1.0.0", ...extra };
}
const review = (id: string, text: string, reply: string | null = null) => ({
  id,
  stars: 4,
  text,
  version: "1.0.0",
  date: "2026-10-01",
  author: { name: "Mara", initials: null, picture: null },
  reply: reply ? { text: reply, date: "2026-10-02" } : null,
});

async function mountReviews(first: CatalogReviewsResult) {
  host.api.catalogReviews.mockResolvedValueOnce(first);
  app = createApp(defineComponent({ render: () => h(CatalogReviewsView, { moduleId: "wellbrained.tracker", moduleName: "Tracker", publisher: "wellbrained" }) }));
  app.mount(root);
  await settle();
}

describe("ratings and reviews", () => {
  it("posting shows the rating at once, without disabling anything, and Delete waits for the save", async () => {
    const saving = deferred<{ ok: boolean }>();
    host.act.mockReturnValueOnce(saving.promise);
    host.api.catalogReviews.mockResolvedValue(reviews({ mine: { stars: 5, text: null, version: "1.0.0", hidden: false, held: false } }));
    await mountReviews(reviews());
    expect($("catalog-reviews-post")!.textContent).toContain("Post");
    await click("star-5");
    await click("catalog-reviews-post");
    // Not saved yet: it already reads Update, nothing is switched off, and Delete is off.
    expect($("catalog-reviews-post")!.textContent).toContain("Update");
    expect(($("star-5") as HTMLButtonElement).disabled).toBe(false);
    expect(($("catalog-reviews-text") as HTMLTextAreaElement).disabled).toBe(false);
    expect(($("catalog-reviews-delete") as HTMLButtonElement).disabled).toBe(true);
    expect(host.notSaved).not.toHaveBeenCalled();
    saving.resolve(ok);
    await settle();
    expect($("catalog-reviews-post")!.textContent).toContain("Update");
    expect(($("catalog-reviews-delete") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed post puts the old state back, keeps what was typed, says so and looks at the service again", async () => {
    host.act.mockResolvedValueOnce({ ok: false, error: "Can't reach the service." });
    await mountReviews(reviews());
    host.api.catalogReviews.mockResolvedValue(reviews());
    await click("star-4");
    await type("catalog-reviews-text", "Works well");
    await click("catalog-reviews-post");
    expect(host.notSaved).toHaveBeenCalledTimes(1);
    expect(host.notSaved.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(host.notSaved.mock.calls[0]![1]).toBe("Couldn't post your review. It's still in the box.");
    expect($("catalog-reviews-post")!.textContent).toContain("Post");
    expect(($("catalog-reviews-text") as HTMLTextAreaElement).value).toBe("Works well");
    expect(($("catalog-reviews-post") as HTMLButtonElement).disabled).toBe(false);
    // The request may have landed although the answer was lost: the list is read again.
    expect(host.api.catalogReviews).toHaveBeenCalledTimes(2);
  });

  it("Keep my rating has its own words when it fails", async () => {
    host.act.mockResolvedValueOnce({ ok: false, error: "offline" });
    await mountReviews(reviews({ mine: { stars: 4, text: null, version: "0.9.0", hidden: false, held: false } }));
    host.api.catalogReviews.mockResolvedValue(reviews({ mine: { stars: 4, text: null, version: "0.9.0", hidden: false, held: false } }));
    expect($("catalog-reviews-older")).not.toBeNull();
    await click("catalog-reviews-keep");
    expect(host.notSaved.mock.calls[0]![1]).toBe("Couldn't update your rating. Try again.");
    expect($("catalog-reviews-older")).not.toBeNull();
  });

  it("a save that worked is not undone when looking at the list again fails", async () => {
    host.act.mockResolvedValueOnce(ok);
    await mountReviews(reviews());
    host.api.catalogReviews.mockResolvedValue({ status: "unreachable" });
    await click("star-3");
    await click("catalog-reviews-post");
    expect(host.notSaved).not.toHaveBeenCalled();
    // The section stays a list, and shows the rating that was saved.
    expect($("catalog-reviews-missing")).toBeNull();
    expect($("catalog-reviews-post")!.textContent).toContain("Update");
  });

  it("a rejected look at the list is not a failed save either", async () => {
    host.act.mockResolvedValueOnce(ok);
    await mountReviews(reviews());
    host.api.catalogReviews.mockRejectedValue(new Error("boom"));
    await click("star-3");
    await click("catalog-reviews-post");
    expect(host.notSaved).not.toHaveBeenCalled();
    expect($("catalog-reviews-post")!.textContent).toContain("Update");
  });

  it("an older answer that lands late does not replace a newer one", async () => {
    // The first post fails; the look at the list that follows is slow. A second post works and its look is quick.
    host.act.mockResolvedValueOnce({ ok: false, error: "offline" }).mockResolvedValueOnce(ok);
    await mountReviews(reviews());
    const slow = deferred<CatalogReviewsResult>();
    const quick = deferred<CatalogReviewsResult>();
    host.api.catalogReviews.mockReturnValueOnce(slow.promise).mockReturnValueOnce(quick.promise);
    await click("star-3");
    await click("catalog-reviews-post");
    await click("catalog-reviews-post");
    quick.resolve(reviews({ reviews: [review("fresh", "FRESH TEXT")] }));
    await settle();
    expect(root.textContent).toContain("FRESH TEXT");
    slow.resolve(reviews({ reviews: [review("old", "STALE TEXT")] }));
    await settle();
    expect(root.textContent).toContain("FRESH TEXT");
    expect(root.textContent).not.toContain("STALE TEXT");
  });

  it("a failed reply keeps its draft even when another reply was opened meanwhile", async () => {
    const sending = deferred<{ ok: boolean; error?: string }>();
    host.act.mockReturnValueOnce(sending.promise);
    host.api.catalogReviews.mockResolvedValue(reviews({ can: "own", reviews: [review("r1", "First"), review("r2", "Second")] }));
    await mountReviews(reviews({ can: "own", reviews: [review("r1", "First"), review("r2", "Second")] }));
    const start = (id: string) => root.querySelector(`[data-testid="catalog-review-${id}"] [data-testid="catalog-review-reply-start"]`) as HTMLElement;
    start("r1").click();
    await settle();
    await type("catalog-review-reply-text", "Thanks, fixed in 1.0.1");
    await click("catalog-review-reply-send");
    // It shows at once.
    expect(root.querySelector('[data-testid="catalog-review-r1"] [data-testid="catalog-review-reply"]')!.textContent).toContain("Thanks, fixed in 1.0.1");
    // Meanwhile another editor opens.
    start("r2").click();
    await settle();
    await type("catalog-review-reply-text", "Other draft");
    sending.resolve({ ok: false, error: "offline" });
    await settle();
    expect(host.notSaved).toHaveBeenCalledTimes(1);
    // The first reply went back; the open editor is still the second one, with its own text.
    expect(root.querySelector('[data-testid="catalog-review-r1"] [data-testid="catalog-review-reply"]')).toBeNull();
    expect(($("catalog-review-reply-text") as HTMLTextAreaElement).value).toBe("Other draft");
    // Closing it and opening the first one again brings its draft back.
    const cancel = [...root.querySelectorAll('[data-testid="catalog-review-r2"] button')].find((button) => button.textContent?.trim() === "Cancel") as HTMLElement;
    cancel.click();
    await settle();
    start("r1").click();
    await settle();
    expect(($("catalog-review-reply-text") as HTMLTextAreaElement).value).toBe("Thanks, fixed in 1.0.1");
  });

  it("Delete reply and Reply are off while the reply is still saving", async () => {
    const sending = deferred<{ ok: boolean }>();
    host.act.mockReturnValueOnce(sending.promise);
    host.api.catalogReviews.mockResolvedValue(reviews({ can: "own", reviews: [review("r1", "First", "Done")] }));
    await mountReviews(reviews({ can: "own", reviews: [review("r1", "First")] }));
    const row = () => root.querySelector('[data-testid="catalog-review-r1"]')!;
    (row().querySelector('[data-testid="catalog-review-reply-start"]') as HTMLElement).click();
    await settle();
    await type("catalog-review-reply-text", "Done");
    await click("catalog-review-reply-send");
    const buttons = [...row().querySelectorAll("button")] as HTMLButtonElement[];
    const byText = (text: string) => buttons.find((button) => button.textContent?.trim() === text)!;
    expect((row().querySelector('[data-testid="catalog-review-reply-start"]') as HTMLButtonElement).disabled).toBe(true);
    expect(byText("Delete reply").disabled).toBe(true);
    sending.resolve(ok);
    await settle();
    expect((row().querySelector('[data-testid="catalog-review-reply-start"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

// ── Contact choice ────────────────────────────────────────────────────────

function mountContact(initial: { kind: string; value: string | null }, save: (contact: { kind: string; value: string | null }) => Promise<string | null>) {
  const contact = shallowRef(initial);
  app = createApp(defineComponent({ render: () => h(ContactChoice, { contact: contact.value as never, name: "Tracker", save: save as never, testid: "contact" }) }));
  app.mount(root);
  return contact;
}

describe("contact choice", () => {
  it("a choice without an address shows as saved at once, and stays when it worked", async () => {
    const saving = deferred<string | null>();
    const contact = mountContact({ kind: "tavora", value: null }, () => saving.promise);
    await settle();
    await click("pick-none");
    expect($("contact")!.dataset.kind).toBe("none");
    saving.resolve(null);
    await settle();
    // The state the host pushes arrives a moment later; the screen doesn't go back in between.
    expect($("contact")!.dataset.kind).toBe("none");
    contact.value = { kind: "none", value: null };
    await settle();
    expect($("contact")!.dataset.kind).toBe("none");
    expect(host.notSaved).not.toHaveBeenCalled();
  });

  it("a choice that can't be saved goes back, says so and asks the service what it has", async () => {
    mountContact({ kind: "tavora", value: null }, async () => "Can't reach the service.");
    await settle();
    await click("pick-none");
    expect(host.notSaved).toHaveBeenCalledTimes(1);
    expect($("contact")!.dataset.kind).toBe("tavora");
    expect($("select")!.dataset.value).toBe("tavora");
    expect(host.act).toHaveBeenCalledWith({ type: "inbox-refresh" }, { quiet: true });
  });

  it("when the failed choice is no longer the picked one, the new pick is left alone", async () => {
    const saving = deferred<string | null>();
    mountContact({ kind: "tavora", value: null }, () => saving.promise);
    await settle();
    await click("pick-none");
    // Meanwhile the user moves on to a choice that needs an address.
    await click("pick-email");
    saving.resolve("Can't reach the service.");
    await settle();
    expect($("contact")!.dataset.kind).toBe("tavora");
    expect($("select")!.dataset.value).toBe("email");
  });

  it("an address that can't be saved stays typed, so it can be sent again", async () => {
    mountContact({ kind: "tavora", value: null }, async () => "offline");
    await settle();
    await click("pick-email");
    await type("contact-value", "me@example.com");
    ($("contact-save") as HTMLButtonElement).click();
    await settle();
    expect(host.notSaved).toHaveBeenCalledTimes(1);
    expect(($("contact-value") as HTMLInputElement).value).toBe("me@example.com");
    expect(($("contact-save") as HTMLButtonElement).disabled).toBe(false);
    expect($("contact")!.dataset.kind).toBe("tavora");
  });
});
