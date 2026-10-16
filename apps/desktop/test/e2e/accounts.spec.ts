// Signing in to a Tavora account, end to end: the real service (apps/api) with
// its test inbox, and the app reading the code out of the "mail".
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { desktopDir, launch } from "./harness";

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
  stateDir = await mkdtemp(path.join(tmpdir(), "tavora-e2e-api-"));
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

/** The code in the newest mail to an address. */
async function codeFor(email: string): Promise<string> {
  let code = "";
  await expect
    .poll(async () => {
      const { mails } = (await (await fetch(`${inboxUrl}/mails`)).json()) as { mails: { to: string; text: string }[] };
      code = /\b(\d{6})\b/.exec(mails.find((mail) => mail.to === email)?.text ?? "")?.[1] ?? "";
      return code;
    })
    .not.toBe("");
  return code;
}

test("a player creates an account with an emailed code, sees this PC, and signs out", async () => {
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: apiUrl } });
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-account").click();

    await page.getByTestId("account-email").fill("player@example.com");
    await page.getByTestId("account-send-code").click();
    await expect(page.getByTestId("account-code-sent")).toContainText("player@example.com");

    await page.getByTestId("account-code").fill(await codeFor("player@example.com"));
    await page.getByTestId("account-verify").click();
    // A new address: the app asks before it makes the account.
    await page.getByTestId("account-create").click();

    await expect(page.getByTestId("account")).toContainText("player@example.com");
    await expect(page.getByTestId("account-devices")).toContainText(process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux");
    await expect(page.getByTestId("account-devices")).toContainText("This PC");

    await page.getByTestId("account-sign-out").click();
    await expect(page.getByTestId("account-email")).toBeVisible();
  } finally {
    await app.close();
  }
});
