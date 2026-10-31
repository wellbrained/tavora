// Leaderboards end to end (decided 2026-10-28): the real service (apps/api) with its test inbox, a signed-in
// account, and a small probe module from test/connector-fixtures on its development test boards. Tavora asks in
// the module's panel before anything goes public, only after the user's own click, and the user can leave the
// boards again from Settings whatever the module offers.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { clickInModule, desktopDir, expectModuleText, inModule, launch } from "./harness";

const PROBE = "local.test.leaderboards-probe";
/** Not in test/fixtures, which every launch loads: a module with the leaderboards connector would show its settings in every spec. */
const PROBES = path.join(desktopDir, "test/connector-fixtures");
const apiDir = path.resolve(desktopDir, "../api");
let service: ChildProcess | undefined;
let stateDir = "";
let apiUrl = "";
let inboxUrl = "";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

/** Node from the test runner itself, in the service's folder (it runs its TypeScript directly). */
const node = (args: string[], env: Record<string, string> = {}) => spawn(process.execPath, args, { cwd: apiDir, env: { ...process.env, ...env }, stdio: "ignore" });

test.beforeAll(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "tavora-e2e-leaderboards-"));
  const games = path.join(stateDir, "games.sqlite");
  // A one-game dataset: the service will not start without one.
  await new Promise<void>((resolve, reject) => {
    const build = node(["--input-type=module", "-e", `const d = await import("./src/dataset.ts"); d.writeDatabase(${JSON.stringify(games)}, d.buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));`]);
    build.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`dataset build failed: ${code}`))));
  });
  const [port, inboxPort] = [await freePort(), await freePort()];
  service = node(["src/server.ts"], { PORT: String(port), TAVORA_GAMES_DB: games, TAVORA_STATE_DIR: stateDir, TAVORA_ICONS_DIR: path.join(stateDir, "icons"), TAVORA_TEST_INBOX_PORT: String(inboxPort), NODE_ENV: "test" });
  apiUrl = `http://127.0.0.1:${port}`;
  inboxUrl = `http://127.0.0.1:${inboxPort}`;
  await expect.poll(async () => (await fetch(`${inboxUrl}/mails`).catch(() => null))?.ok ?? false, { timeout: 15_000 }).toBe(true);
});

test.afterAll(async () => {
  service?.kill();
  await rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
});

/** Makes an account with an emailed code, in the profile dialog's Account, and closes the dialog. */
async function signUp(page: Page, email: string) {
  await page.getByTestId("rail-profile").click();
  await page.getByTestId("profile-nav-account").click();
  await page.getByTestId("account-email").fill(email);
  await page.getByTestId("account-send-code").click();
  let code = "";
  await expect
    .poll(async () => {
      const { mails } = (await (await fetch(`${inboxUrl}/mails`)).json()) as { mails: { to: string; text: string }[] };
      code = /\b(\d{6})\b/.exec(mails.find((mail) => mail.to === email)?.text ?? "")?.[1] ?? "";
      return code;
    })
    .not.toBe("");
  await page.getByTestId("account-code").fill(code);
  await page.getByTestId("account-verify").click();
  await page.getByTestId("account-age").check();
  await page.getByTestId("account-create").click();
  await expect(page.getByTestId("account")).toContainText(email);
  await page.getByTestId("profile-close").click();
}

/** A real key press in the probe's page, so what follows counts as the user's own click. */
async function gesture(app: ElectronApplication) {
  await app.evaluate(({ webContents }, moduleId) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
    if (!target) throw new Error("no panel");
    target.sendInputEvent({ type: "keyDown", keyCode: "Shift" });
    target.sendInputEvent({ type: "keyUp", keyCode: "Shift" });
  }, PROBE);
}

type Answer = { ok: boolean; result?: Record<string, unknown>; error?: { code: string } };
/** One call from the probe's page, with the host's answer. */
const call = (app: ElectronApplication, method: string, params?: unknown) => inModule<Answer>(app, PROBE, `window.probe.call(${JSON.stringify(method)}, ${JSON.stringify(params)})`);
/** What the host answered the probe's button so far. */
const answers = (app: ElectronApplication, label: string) =>
  inModule<Answer[]>(app, PROBE, `window.probe.results.filter((r) => r.label === ${JSON.stringify(label)}).map((r) => r.answer)`).catch(() => []);

test("a module's results go public only after the user says yes in its panel, and leave from Settings deletes them", async () => {
  const { app, page } = await launch(undefined, [PROBES], { env: { TAVORA_API_URL: apiUrl } });
  try {
    await signUp(page, "ranked@example.com");

    // Adding it asks first, in Tavora's words, what the connector does.
    await page.getByTestId("add-module").click();
    await page.getByTestId(`open-${PROBE}`).click();
    await expect(page.getByTestId("grant-leaderboards")).toContainText("only after you say yes in its panel");
    await page.getByTestId("grant-allow").click();
    await expectModuleText(app, PROBE, "probe-status", "ready");

    // A development copy gets test boards at once; nothing is public, and the module has no name yet.
    expect(await call(app, "leaderboards.status")).toMatchObject({ ok: true, result: { online: true, signedIn: true, available: true, shown: false, name: null } });
    const day = new Date().toISOString().slice(0, 10);
    const today = { id: randomUUID(), outcome: "won", at: Date.now(), day };
    expect(await call(app, "leaderboards.submit", { board: "daily", results: [today] })).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });

    // Without the user's own click Tavora asks nothing.
    await clickInModule(app, PROBE, "probe-show");
    await expect.poll(async () => (await answers(app, "show")).length).toBe(1);
    expect((await answers(app, "show"))[0]).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    await expect(page.getByTestId("leaderboard-question")).toHaveCount(0);

    // After it, the question shows in the panel's place; Not now leaves everything private.
    await gesture(app);
    await clickInModule(app, PROBE, "probe-show");
    await expect(page.getByTestId("leaderboard-question")).toContainText("Your Tavora name and your results in Leaderboards Probe will be public.");
    await page.getByTestId("leaderboard-question-no").click();
    await expect(page.getByTestId("leaderboard-question")).toHaveCount(0);
    await expect.poll(async () => (await answers(app, "show")).length).toBe(2);
    expect((await answers(app, "show"))[1]).toMatchObject({ ok: true, result: { shown: false, name: null } });

    // Yes shows the user, under a name the boards can show.
    await gesture(app);
    await clickInModule(app, PROBE, "probe-show");
    await page.getByTestId("leaderboard-question-yes").click();
    await expect.poll(async () => (await answers(app, "show")).length).toBe(3);
    const shown = (await answers(app, "show"))[2]!;
    expect(shown).toMatchObject({ ok: true, result: { online: true, shown: true } });
    const name = shown.result!.name as string;
    expect(name).toBeTruthy();
    await expectModuleText(app, PROBE, "probe-status", "ready");

    // Each result is taken or refused on its own; an archive replay never counts.
    const replay = { id: randomUUID(), outcome: "won", at: Date.now(), day: "2026-01-01" };
    expect(await call(app, "leaderboards.submit", { board: "daily", results: [today, replay] })).toMatchObject({
      ok: true,
      result: { accepted: [today.id], rejected: [{ id: replay.id, reason: "archive" }] },
    });
    expect(await call(app, "leaderboards.top", { board: "daily", day })).toMatchObject({ ok: true, result: { rows: [{ rank: 1, name, self: true, current: 1, best: 1 }] } });

    // Periods: the user's own line in a week, and their standing on every board in every period. The probe is made for
    // Tavora 0.21.92, before boards had names (like Sudoku 0.1.0), so each board goes by its id.
    expect(await call(app, "leaderboards.top", { board: "daily", period: "week", day })).toMatchObject({ ok: true, result: { rows: [{ rank: 1, of: 1, self: true }] } });
    expect(await call(app, "leaderboards.mine", {})).toMatchObject({
      ok: true,
      result: { boards: [{ id: "daily", name: "daily", periods: { day: null, all: { rank: 1, of: 1, current: 1, best: 1 } } }, { id: "fastest", name: "fastest", periods: { all: null } }] },
    });
    // A result without a day, as a module made for 0.21.92 sends it: Tavora fills the day in, so it still counts.
    const time = { id: randomUUID(), value: 83, at: Date.now() };
    expect(await call(app, "leaderboards.submit", { board: "fastest", results: [time] })).toMatchObject({ ok: true, result: { accepted: [time.id] } });
    expect(await call(app, "leaderboards.mine", { day })).toMatchObject({ ok: true, result: { boards: [{ id: "daily" }, { id: "fastest", periods: { all: { rank: 1, of: 1, value: 83 } } }] } });

    // The profile lists catalog modules only, so a development copy never shows there; the ranks can be hidden and shown.
    await page.getByTestId("rail-profile").click();
    await expect(page.getByTestId("profile-ranks")).toContainText("Join a game's leaderboard");
    await page.getByTestId("profile-ranks-shown").click();
    await expect(page.getByTestId("profile-ranks")).not.toContainText("Join a game's leaderboard");
    await page.getByTestId("profile-ranks-shown").click();
    await expect(page.getByTestId("profile-ranks")).toContainText("Join a game's leaderboard");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("profile-dialog")).toHaveCount(0);

    // Leaving from Settings takes the user off and deletes the results there.
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-connections").click();
    await page.getByTestId("connection-leaderboards-toggle").click();
    await page.getByTestId(`leaderboards-leave-${PROBE}`).click();
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm")).toHaveCount(0);
    await page.getByTestId("settings-close").click();
    expect(await call(app, "leaderboards.status")).toMatchObject({ ok: true, result: { shown: false, name: null } });
    expect(await call(app, "leaderboards.top", { board: "daily", day })).toMatchObject({ ok: true, result: { rows: [] } });
  } finally {
    await app.close();
  }
});

test("signed out, the question offers to sign in, and the module says offline instead of failing without the service", async () => {
  const { app, page } = await launch(undefined, [PROBES], { env: { TAVORA_API_URL: apiUrl } });
  try {
    await page.getByTestId("add-module").click();
    await page.getByTestId(`open-${PROBE}`).click();
    await page.getByTestId("grant-allow").click();
    await expectModuleText(app, PROBE, "probe-status", "ready");
    expect(await call(app, "leaderboards.status")).toMatchObject({ ok: true, result: { online: true, signedIn: false, available: true, shown: false } });

    await gesture(app);
    await clickInModule(app, PROBE, "probe-show");
    await expect(page.getByTestId("leaderboard-question")).toContainText("Sign in to show your results");
    await page.getByTestId("leaderboard-question-yes").click();
    await expect(page.getByTestId("profile-nav-account")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("profile-close").click();
    await expect.poll(async () => (await answers(app, "show")).length).toBe(1);
    expect((await answers(app, "show"))[0]).toMatchObject({ ok: true, result: { signedIn: false, shown: false } });
  } finally {
    await app.close();
  }
  // Without the service: a status that says offline, never an error.
  const offline = await launch(undefined, [PROBES], { env: { TAVORA_API_URL: `http://127.0.0.1:${await freePort()}` } });
  try {
    await offline.page.getByTestId("add-module").click();
    await offline.page.getByTestId(`open-${PROBE}`).click();
    await offline.page.getByTestId("grant-allow").click();
    await expectModuleText(offline.app, PROBE, "probe-status", "ready");
    expect(await call(offline.app, "leaderboards.status")).toMatchObject({ ok: true, result: { online: false, available: false, shown: false, name: null } });
  } finally {
    await offline.app.close();
  }
});
