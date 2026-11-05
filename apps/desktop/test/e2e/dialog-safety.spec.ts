// Two safety rules for dialogs over the workspace:
// - module panels are native views drawn above the page, so every dialog must make them step aside, whatever shell it
//   is built on (the page counts the open dialogs itself, so none can be forgotten);
// - a question the host asks on its own (where to open a link, a game to switch to, a connector to allow) waits for any
//   dialog the user is working in, comes in order of urgency, and never takes a dialog's place for good.
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { EMPTY_INBOX } from "../../src/shared/conversations";
import type { CloudCopyView, HostViewState, PublishView } from "../../src/shared/host-api";
import { desktopDir, expectModuleText, inModule, launch, openModule, panels, VANILLA } from "./harness";

/** How many module views are on screen right now (asked of the main process). */
const viewsOnScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .flatMap((window) => window.contentView.children)
      .filter((view) => (view as unknown as { webContents?: { getURL(): string } }).webContents?.getURL().startsWith("tavora-module://"))
      .filter((view) => (view as unknown as { getVisible(): boolean }).getVisible()).length,
  );

/** Sends the page something on one of the channels the main process uses. */
const send = (app: ElectronApplication, channel: string, payload: unknown) =>
  app.evaluate(({ BrowserWindow }, { channel, payload }) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel, payload), { channel, payload });

const currentState = (page: Page) => page.evaluate(() => (window as unknown as { tavoraHost: { getState(): Promise<HostViewState> } }).tavoraHost.getState());

/**
 * Makes the main process hold something in the state it sends, the way it does until the user answers (a question to
 * open a link, a connector asked for ...): every state it sends has these fields in it, so a state pushed by something
 * else (a saved layout) does not end them. `release` takes them out again.
 */
async function holdState(app: ElectronApplication, page: Page, patch: Partial<HostViewState> | ((state: HostViewState) => Partial<HostViewState>)) {
  const fields = typeof patch === "function" ? patch(await currentState(page)) : patch;
  await app.evaluate(({ BrowserWindow }, fields) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    const held = globalThis as unknown as { __held?: Record<string, unknown>; __holding?: boolean };
    held.__held = { ...(held.__held ?? {}), ...fields };
    if (held.__holding) return;
    held.__holding = true;
    const original = contents.send.bind(contents) as (channel: string, ...args: unknown[]) => void;
    contents.send = (channel: string, ...args: unknown[]) => {
      const first = args[0];
      original(channel, ...(channel === "host:state" && first ? [{ ...(first as object), ...held.__held }, ...args.slice(1)] : args));
    };
  }, fields);
  await send(app, "host:state", { ...(await currentState(page)), ...fields });
}

async function release(app: ElectronApplication, page: Page, ...keys: (keyof HostViewState)[]) {
  await app.evaluate((_, keys) => {
    const held = globalThis as unknown as { __held?: Record<string, unknown> };
    for (const key of keys) delete held.__held?.[key];
  }, keys);
  await send(app, "host:state", await currentState(page));
}

async function withPanel() {
  const running = await launch();
  await running.page.getByTestId("empty-template-main-stacked").click();
  await openModule(running.page, VANILLA);
  await expect(panels(running.page, VANILLA)).toBeVisible();
  await expect.poll(() => viewsOnScreen(running.app)).toBeGreaterThan(0);
  return running;
}

const PAIRING = { id: "0123456789abcdef", name: "Laptop", code: "123 456" };
const sendPairing = (app: ElectronApplication, approve: typeof PAIRING | null) => send(app, "host:pairing", { asking: null, approve });

async function openPrompt(page: Page) {
  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]').click();
  await expect(page.getByTestId("prompt-input")).toBeVisible();
}

const CONNECTOR = { id: 5, moduleId: VANILLA, connectors: ["system-info" as const] };

test("the Pairing question hides the panels while it is open", async () => {
  const { app, page } = await withPanel();
  try {
    await sendPairing(app, PAIRING);
    await expect(page.getByTestId("pairing-approve")).toBeVisible();
    await expect.poll(() => viewsOnScreen(app)).toBe(0);
    await sendPairing(app, null);
    await expect(page.getByTestId("pairing-approve")).toHaveCount(0);
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

// The dialogs below sit outside the dialog slot and come from state the main process sends; each hides the panels
// while it is open and gives them back once it closes.
const SHELLS: { name: string; testid: string; open(app: ElectronApplication, page: Page): Promise<void>; close(app: ElectronApplication, page: Page): Promise<void> }[] = [
  {
    name: "the official Publish dialog",
    testid: "official-publish-dialog",
    open: (app, page) => holdState(app, page, (state) => ({ officialPublish: { ...state.officialPublish, run: { phase: "building", moduleId: "tavora.notes", name: "Notes", step: "build" } } })),
    close: (app, page) => release(app, page, "officialPublish"),
  },
  {
    name: "the hotkey dialog",
    testid: "hotkey-dialog",
    open: (app, page) => holdState(app, page, { hotkeyRequest: { id: 1, moduleName: "Notes", actionName: "open", label: "Open Notes", current: null, error: null } }),
    close: (app, page) => release(app, page, "hotkeyRequest"),
  },
  {
    name: "the cloud copy question",
    testid: "cloud-copy-question",
    open: (app) => send(app, "host:cloud-copy", copyView(true)),
    close: (app) => send(app, "host:cloud-copy", copyView(false)),
  },
  {
    name: "the Publish review",
    testid: "publish-review",
    open: (app) => send(app, "host:publish", publishView()),
    close: (app) => send(app, "host:publish", null),
  },
  {
    name: "an inbox note",
    testid: "inbox-developer-note",
    open: (app) => send(app, "host:inbox", { ...EMPTY_INBOX, developerNote: true }),
    close: (app) => send(app, "host:inbox", EMPTY_INBOX),
  },
];

function copyView(conflict: boolean): CloudCopyView {
  return { canKeepKey: true, devData: false, on: true, busy: null, progress: null, copy: null, folder: null, limit: null, pictures: false, recoveryKey: null, askKey: false, conflict, restartToTake: false, closing: false, problem: null };
}

function publishView(): PublishView {
  return {
    project: "dialog-safety",
    status: "ready",
    module: { id: "example.safety", name: "Safety", version: "1.0.0", icon: null },
    notes: ["A change."],
    readme: null,
    asks: { network: [], connectors: [], folders: [] },
    size: 1024,
    builtAt: null,
    sourceNewer: false,
    catalog: { kind: "first" },
    problems: [],
    newPrefix: null,
    ownPrefix: "example",
    error: null,
    published: null,
  };
}

for (const shell of SHELLS) {
  test(`${shell.name} hides the panels while it is open, and they come back when it closes`, async () => {
    const { app, page } = await withPanel();
    try {
      await shell.open(app, page);
      await expect(page.getByTestId(shell.testid)).toBeVisible();
      await expect.poll(() => viewsOnScreen(app)).toBe(0);
      await shell.close(app, page);
      await expect(page.getByTestId(shell.testid)).toHaveCount(0);
      await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
}

test("a link question that arrives while a prompt is open waits, and shows once the prompt is closed", async () => {
  const { app, page } = await withPanel();
  try {
    await openPrompt(page);
    const input = page.getByTestId("prompt-input");
    await input.fill("Mapping");

    // The module asked to open a link: the prompt stays as it is, with what was typed in it.
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await expect(page.getByTestId("prompt")).toBeVisible();
    await expect(input).toHaveValue("Mapping");
    await expect(page.getByTestId("link-choice")).toHaveCount(0);

    await page.getByTestId("prompt-submit").click();
    await expect(page.getByTestId("prompt")).toHaveCount(0);
    await expect(page.getByTestId("link-choice")).toBeVisible();
    await expect(page.getByTestId("link-choice-url")).toHaveText("https://example.com/queued");
    // The prompt did what it was asked: the layout is saved.
    await release(app, page, "pendingLink");
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await page.getByTestId("layouts").click();
    await expect(page.locator('[role="menu"][data-state="open"]').getByText("Mapping")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("a question that ends while it is shown, or while it waits, goes away", async () => {
  const { app, page } = await withPanel();
  try {
    // Shown: where to open a link, and a game to switch to, close when the host drops the question.
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await expect(page.getByTestId("link-choice")).toBeVisible();
    await release(app, page, "pendingLink");
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await holdState(app, page, { pendingGameSwitch: "satisfactory" });
    await expect(page.getByTestId("game-switch")).toBeVisible();
    await release(app, page, "pendingGameSwitch");
    await expect(page.getByTestId("game-switch")).toHaveCount(0);
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);

    // Waiting: a connector asked for while a prompt is open, then withdrawn, does not show when the prompt closes.
    await openPrompt(page);
    await holdState(app, page, { pendingConnector: CONNECTOR });
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
    await release(app, page, "pendingConnector");
    await page.getByTestId("prompt-input").fill("Mapping");
    await page.getByTestId("prompt-submit").click();
    await expect(page.getByTestId("prompt")).toHaveCount(0);
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("a consent asked for while a link question is shown goes first, and the link question comes back after", async () => {
  const { app, page } = await withPanel();
  try {
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await expect(page.getByTestId("link-choice")).toBeVisible();
    await holdState(app, page, { pendingConnector: CONNECTOR });
    await expect(page.getByTestId("grant-dialog")).toBeVisible();
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await release(app, page, "pendingConnector");
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
    await expect(page.getByTestId("link-choice-url")).toHaveText("https://example.com/queued");
    await expect.poll(() => viewsOnScreen(app)).toBe(0);
    await release(app, page, "pendingLink");
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test("a game to switch to waits behind a link question, and both show in turn", async () => {
  const { app, page } = await withPanel();
  try {
    await holdState(app, page, { pendingGameSwitch: "satisfactory" });
    await expect(page.getByTestId("game-switch")).toBeVisible();
    // The link question is the more urgent one: it takes the place, the game question comes back after it.
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await expect(page.getByTestId("link-choice")).toBeVisible();
    await expect(page.getByTestId("game-switch")).toHaveCount(0);
    await page.getByTestId("link-choice-cancel").click();
    await release(app, page, "pendingLink");
    await expect(page.getByTestId("game-switch")).toBeVisible();
    await release(app, page, "pendingGameSwitch");
    await expect(page.getByTestId("game-switch")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("a link question waits behind a dialog outside the slot, and shows when it closes", async () => {
  const { app, page } = await withPanel();
  try {
    await sendPairing(app, PAIRING);
    await expect(page.getByTestId("pairing-approve")).toBeVisible();
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await sendPairing(app, null);
    await expect(page.getByTestId("link-choice")).toBeVisible();
    await release(app, page, "pendingLink");
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("a link question opens on top of Settings", async () => {
  const { app, page } = await withPanel();
  try {
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("settings")).toBeVisible();
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await expect(page.getByTestId("link-choice")).toBeVisible();
    await expect(page.getByTestId("settings")).toBeVisible();
    await release(app, page, "pendingLink");
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await expect(page.getByTestId("settings")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("a dialog the user opens over a link question does not lose it", async () => {
  const { app, page } = await withPanel();
  try {
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await expect(page.getByTestId("link-choice")).toBeVisible();
    // A shortcut or a click that gets past the backdrop opens Add game over it.
    await page.getByTestId("rail-add-game").evaluate((button) => (button as HTMLElement).click());
    await expect(page.getByTestId("add-game-dialog")).toBeVisible();
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("add-game-dialog")).toHaveCount(0);
    await expect(page.getByTestId("link-choice-url")).toHaveText("https://example.com/queued");
  } finally {
    await app.close();
  }
});

test("the panels stay out of sight from one dialog of the slot to the next", async () => {
  const { app, page } = await withPanel();
  try {
    // Every change the page tells the main process about the overlay, from here on.
    await app.evaluate(({ ipcMain }) => {
      const log: boolean[] = [];
      (globalThis as unknown as { __overlayLog: boolean[] }).__overlayLog = log;
      ipcMain.on("host:overlay", (_event, open: boolean) => log.push(open));
    });
    const log = () => app.evaluate(() => (globalThis as unknown as { __overlayLog: boolean[] }).__overlayLog);

    await openPrompt(page);
    await expect.poll(() => viewsOnScreen(app)).toBe(0);
    // (The menu that opened the prompt closed and the prompt opened: that is not what is looked at here.)
    await app.evaluate(() => ((globalThis as unknown as { __overlayLog: boolean[] }).__overlayLog.length = 0));
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await page.getByTestId("prompt-input").fill("Mapping");
    await page.getByTestId("prompt-submit").click();
    await expect(page.getByTestId("link-choice")).toBeVisible();
    // The prompt went and the link question came in one go: no "closed" in between, so no panel was shown for a moment.
    expect(await log()).toEqual([]);
    expect(await viewsOnScreen(app)).toBe(0);
    await release(app, page, "pendingLink");
    await expect.poll(() => viewsOnScreen(app)).toBeGreaterThan(0);
    expect(await log()).toEqual([false]);
  } finally {
    await app.close();
  }
});

// A panel's dialog (panel.setDialog) keeps its native view in sight above the dimmed app, so a page dialog opened over
// it needs the view to step aside.
const PROBES = path.join(desktopDir, "test/dialog-fixtures");
const PROBE = "local.test.welcome-probe";

test("a page dialog over a panel's dialog hides the panel's view, and it comes back after", async () => {
  const { app, page } = await launch(undefined, [PROBES]);
  try {
    await page.getByTestId("add-module").click();
    await page.getByTestId(`panel-menu-toggle-${PROBE}`).click();
    await page.getByTestId(`open-${PROBE}-welcome`).click();
    await expectModuleText(app, PROBE, "probe-auto", "opened");
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await expect.poll(() => viewsOnScreen(app)).toBe(1);

    await sendPairing(app, PAIRING);
    await expect(page.getByTestId("pairing-approve")).toBeVisible();
    await expect.poll(() => viewsOnScreen(app)).toBe(0);
    // A question the module asks from its dialog shows over it, not behind it.
    await holdState(app, page, { pendingLink: "https://example.com/queued" });
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await sendPairing(app, null);
    await expect(page.getByTestId("link-choice")).toBeVisible();
    expect(await viewsOnScreen(app)).toBe(0);
    await release(app, page, "pendingLink");
    await expect(page.getByTestId("link-choice")).toHaveCount(0);
    await expect(page.getByTestId("panel-dialog")).toBeVisible();
    await expect.poll(() => viewsOnScreen(app)).toBe(1);
    // It is still the module's own page in there.
    expect(await inModule<string>(app, PROBE, "location.href")).toMatch(/^tavora-module:/);
  } finally {
    await app.close();
  }
});
