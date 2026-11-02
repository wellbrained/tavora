// Two safety rules for dialogs over the workspace:
// - module panels are native views drawn above the page, so every dialog must make them step aside (Pairing and the
//   official Publish dialog used to be forgotten in the hand-kept list; ModalDialog.vue now says so for every dialog built on it);
// - a question the host asks on its own (where to open a link) waits for the dialog the user is working in.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { HostViewState } from "../../src/shared/host-api";
import { launch, openModule, panels, VANILLA } from "./harness";

/** How many module views are on screen right now (asked of the main process). */
const viewsOnScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .flatMap((window) => window.contentView.children)
      .filter((view) => (view as unknown as { webContents?: { getURL(): string } }).webContents?.getURL().startsWith("tavora-module://"))
      .filter((view) => (view as unknown as { getVisible(): boolean }).getVisible()).length,
  );

/** Sends the page the state it has, with changes: what the main process would send when these things happen. */
async function pushState(app: ElectronApplication, page: Page, change: Partial<HostViewState> | ((state: HostViewState) => Partial<HostViewState>)) {
  const state = await page.evaluate(() => (window as unknown as { tavoraHost: { getState(): Promise<HostViewState> } }).tavoraHost.getState());
  const next = { ...state, ...(typeof change === "function" ? change(state) : change) };
  await app.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0]!.webContents.send("host:state", next), next);
}

/**
 * Makes the main process hold a question to open a link (state.pendingLink), the way it does until the user answers:
 * every state it sends has the link in it, so a state pushed by something else (a saved layout) does not end it.
 * `null` ends it.
 */
async function holdLink(app: ElectronApplication, page: Page, url: string | null) {
  await app.evaluate(({ BrowserWindow }, url) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    const held = globalThis as unknown as { __heldLink?: string | null; __holding?: boolean };
    held.__heldLink = url;
    if (held.__holding) return;
    held.__holding = true;
    const send = contents.send.bind(contents) as (channel: string, ...args: unknown[]) => void;
    contents.send = (channel: string, ...args: unknown[]) => {
      const first = args[0] as { pendingLink?: string | null } | undefined;
      send(channel, ...(channel === "host:state" && first && held.__heldLink !== undefined ? [{ ...first, pendingLink: held.__heldLink }, ...args.slice(1)] : args));
    };
  }, url);
  await pushState(app, page, {});
}

async function withPanel() {
  const running = await launch();
  await running.page.getByTestId("empty-template-main-stacked").click();
  await openModule(running.page, VANILLA);
  await expect(panels(running.page, VANILLA)).toBeVisible();
  await expect.poll(() => viewsOnScreen(running.app)).toBeGreaterThan(0);
  return running;
}

test("the Pairing question hides the panels while it is open", async () => {
  const { app, page } = await withPanel();
  try {
    const send = (approve: { id: string; name: string | null; code: string } | null) =>
      app.evaluate(({ BrowserWindow }, view) => BrowserWindow.getAllWindows()[0]!.webContents.send("host:pairing", view), { asking: null, approve });
    await send({ id: "0123456789abcdef", name: "Laptop", code: "123 456" });
    await expect(page.getByTestId("pairing-approve")).toBeVisible();
    await expect.poll(() => viewsOnScreen(app)).toBe(0);
    await send(null);
    await expect(page.getByTestId("pairing-approve")).toHaveCount(0);
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test("the official Publish dialog hides the panels while it is open", async () => {
  const { app, page } = await withPanel();
  try {
    await pushState(app, page, (state) => ({ officialPublish: { ...state.officialPublish, run: { moduleId: "tavora.notes", name: "Notes", step: "build", preview: null } } }));
    await expect(page.getByTestId("official-publish-dialog")).toBeVisible();
    await expect.poll(() => viewsOnScreen(app)).toBe(0);
    await pushState(app, page, (state) => ({ officialPublish: { ...state.officialPublish, run: null } }));
    await expect(page.getByTestId("official-publish-dialog")).toHaveCount(0);
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test("a link question that arrives while a prompt is open waits, and shows once the prompt is closed", async () => {
  const { app, page } = await withPanel();
  try {
    await page.getByTestId("layouts").click();
    await page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]').click();
    const input = page.getByTestId("prompt-input");
    await expect(input).toBeVisible();
    await input.fill("Mapping");

    // The module asked to open a link: the prompt stays as it is, with what was typed in it.
    await holdLink(app, page, "https://example.com/queued");
    await expect(page.getByTestId("prompt")).toBeVisible();
    await expect(input).toHaveValue("Mapping");
    await expect(page.getByTestId("link-choice")).toHaveCount(0);

    await page.getByTestId("prompt-submit").click();
    await expect(page.getByTestId("prompt")).toHaveCount(0);
    await expect(page.getByTestId("link-choice")).toBeVisible();
    await expect(page.getByTestId("link-choice-url")).toHaveText("https://example.com/queued");
    // The prompt did what it was asked: the layout is saved.
    await holdLink(app, page, null);
    await page.getByTestId("link-choice-cancel").click();
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await page.getByTestId("layouts").click();
    await expect(page.locator('[role="menu"][data-state="open"]').getByText("Mapping")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("a link question that ended while it waited does not show later", async () => {
  const { app, page } = await withPanel();
  try {
    await page.getByTestId("layouts").click();
    await page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]').click();
    await expect(page.getByTestId("prompt")).toBeVisible();
    await holdLink(app, page, "https://example.com/queued");
    await holdLink(app, page, null);
    await page.getByTestId("prompt-input").fill("Mapping");
    await page.getByTestId("prompt-submit").click();
    await expect(page.getByTestId("prompt")).toHaveCount(0);
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
