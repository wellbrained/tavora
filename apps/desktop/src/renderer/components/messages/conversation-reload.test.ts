// @vitest-environment jsdom
// A conversation that fails to reload keeps its messages: the error shows over them with Try again, instead of
// replacing the whole conversation. The host is a fake.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";

const host = vi.hoisted(() => ({ conversation: vi.fn() }));
vi.mock("../../host", async () => {
  const { shallowRef } = await import("vue");
  return { api: host, act: vi.fn(), confirmAction: vi.fn(), submitAction: vi.fn(), inbox: shallowRef({ items: [] }) };
});
vi.mock("./CloseConversationDialog.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("./ReportConversationDialog.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));

Element.prototype.scrollTo = () => undefined;
import { inbox } from "../../host";
import ConversationView from "./ConversationView.vue";

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
const detail = {
  status: "ok",
  conversation: { id: "c1", kind: "developer", role: "user", state: "open", label: "x", title: "Notes", module: { id: "m", name: "Notes" }, lastMessageAt: "2026-11-24T10:00:00.000Z", unread: false },
  messages: [{ id: "m1", text: "Hello there", at: "2026-11-24T10:00:00.000Z", mine: true, from: "user" }],
};

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});

describe("ConversationView", () => {
  it("keeps the messages when a reload fails, and Try again reads it again", async () => {
    host.conversation.mockResolvedValueOnce(detail);
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(defineComponent({ render: () => h(ConversationView, { id: "c1" }) }));
    app.mount(root);
    await settle();
    expect(root.textContent).toContain("Hello there");

    // The inbox sees a newer message and the reload fails.
    host.conversation.mockResolvedValueOnce({ status: "error", error: "Offline" });
    (inbox as { value: unknown }).value = { items: [{ id: "c1", lastMessageAt: "2026-11-24T11:00:00.000Z" }] };
    await settle();
    expect(root.querySelector('[data-testid="conversation-reload-error"]')?.textContent).toContain("Offline");
    expect(root.textContent).toContain("Hello there");

    host.conversation.mockResolvedValueOnce(detail);
    (root.querySelector('[data-testid="conversation-retry"]') as HTMLElement).click();
    await settle();
    expect(root.querySelector('[data-testid="conversation-reload-error"]')).toBeNull();
    expect(root.textContent).toContain("Hello there");
  });
});
