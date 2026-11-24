// @vitest-environment jsdom
// Escape while an input method (Japanese, Chinese, Korean…) is composing cancels the composition, not what was typed.
import { afterEach, expect, it } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import AddInput from "./AddInput.vue";

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
});

async function mountDraft() {
  const closed = { count: 0 };
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({ render: () => h(AddInput, { placeholder: "New to-do", draft: true, onClose: () => closed.count++ }) });
  app.mount(host);
  await nextTick();
  const input = host.querySelector("input")!;
  input.value = "かんじ";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  return { input, closed };
}

const escape = (input: HTMLInputElement, init: KeyboardEventInit = {}) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init }));

it("keeps the draft when Escape only cancels a composition", async () => {
  const { input, closed } = await mountDraft();
  escape(input, { isComposing: true });
  await nextTick();
  expect(input.value).toBe("かんじ");
  expect(closed.count).toBe(0);
});

it("still clears and closes the draft on a plain Escape", async () => {
  const { input, closed } = await mountDraft();
  escape(input);
  await nextTick();
  expect(input.value).toBe("");
  expect(closed.count).toBe(1);
});
