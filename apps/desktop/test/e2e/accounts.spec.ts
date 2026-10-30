// Signing in to a Tavora account, end to end: the real service (apps/api) with
// its test inbox, and the app reading the code out of the "mail". Discord login
// runs against a pretend Discord: its sign-in page sends the app straight back.
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { createConnection, createServer, type Socket } from "node:net";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { desktopDir, launch } from "./harness";

const apiDir = path.resolve(desktopDir, "../api");
let service: ChildProcess | undefined;
let stateDir = "";
let apiUrl = "";
let inboxUrl = "";
let discord: Server | undefined;
let discordUrl = "";

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
  // A pretend Discord: its sign-in page sends the browser back with a code; the API answers as one user.
  discord = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/oauth2/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.search = new URLSearchParams({ code: "pretendcode123", state: url.searchParams.get("state") ?? "" }).toString();
      response.writeHead(302, { location: back.toString() }).end();
    } else if (url.pathname === "/api/oauth2/token") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "pretend-token", scope: "identify" }));
    } else if (url.pathname === "/api/users/@me") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "123456789012345678", username: "pretend_user" }));
    } else {
      response.writeHead(200).end();
    }
  });
  await new Promise<void>((resolve) => discord!.listen(0, "127.0.0.1", resolve));
  discordUrl = `http://127.0.0.1:${(discord.address() as { port: number }).port}`;
  const [port, inboxPort] = [await freePort(), await freePort()];
  service = node(["src/server.ts"], { PORT: String(port), TAVORA_GAMES_DB: games, TAVORA_STATE_DIR: stateDir, TAVORA_ICONS_DIR: path.join(stateDir, "icons"), TAVORA_TEST_INBOX_PORT: String(inboxPort), DISCORD_API: `${discordUrl}/api`, NODE_ENV: "test" });
  apiUrl = `http://127.0.0.1:${port}`;
  inboxUrl = `http://127.0.0.1:${inboxPort}`;
  await expect.poll(async () => (await fetch(`${inboxUrl}/mails`).catch(() => null))?.ok ?? false, { timeout: 15_000 }).toBe(true);
});

test.afterAll(async () => {
  service?.kill();
  discord?.close();
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

test("a user creates an account with an emailed code, sees this PC, and signs out", async () => {
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: apiUrl } });
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-account").click();

    await page.getByTestId("account-email").fill("user@example.com");
    await page.getByTestId("account-send-code").click();
    await expect(page.getByTestId("account-code-sent")).toContainText("user@example.com");

    await page.getByTestId("account-code").fill(await codeFor("user@example.com"));
    await page.getByTestId("account-verify").click();
    // A new address: the app asks before it makes the account.
    await expect(page.getByTestId("account-create")).toBeDisabled();
    await page.getByTestId("account-age").check();
    await page.getByTestId("account-create").click();

    await expect(page.getByTestId("account")).toContainText("user@example.com");
    // The devices are folded away; each is named after its PC and can be renamed.
    await expect(page.getByTestId("account-devices")).toHaveCount(0);
    await page.getByTestId("account-devices-toggle").click();
    await expect(page.getByTestId("account-devices")).toContainText(process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux");
    await expect(page.getByTestId("account-devices")).toContainText("This PC");
    await expect(page.getByTestId("account-devices")).toContainText(os.hostname().slice(0, 40));
    await page.getByTestId("account-devices").getByRole("button", { name: "Rename" }).click();
    await page.getByTestId("prompt-input").fill("Living room PC");
    await page.getByTestId("prompt-input").press("Enter");
    await expect(page.getByTestId("account-devices")).toContainText("Living room PC");

    await page.getByTestId("account-sign-out").click();
    await expect(page.getByTestId("account-email")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("a user creates a Discord-only account in the browser, adds an email, and the last way in stays", async () => {
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: apiUrl, TAVORA_DISCORD_AUTHORIZE_URL: `${discordUrl}/oauth2/authorize` } });
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-account").click();

    await page.getByTestId("account-discord-sign-in").click();
    // A new Discord login: the app asks, with the age tick box.
    await expect(page.getByTestId("account")).toContainText("@pretend_user");
    await page.getByTestId("account-age").check();
    await page.getByTestId("account-create").click();
    await expect(page.getByTestId("account-discord")).toContainText("@pretend_user");
    await expect(page.getByTestId("account-discord-disconnect")).toHaveCount(0);

    // Add an email with a code; then Discord may be disconnected.
    await page.getByTestId("account-change-email").click();
    await page.getByTestId("account-new-email").fill("discord@example.com");
    await page.getByTestId("account-email-code").click();
    await page.getByTestId("account-code").fill(await codeFor("discord@example.com"));
    await page.getByTestId("account-confirm-email").click();
    await expect(page.getByTestId("account")).toContainText("discord@example.com");

    // Each code form shows once its mail went out, so the newest code to the address is the right one. One
    // address gets at most 3 codes in 15 minutes (A2), so the steps below use two addresses.

    // Disconnecting Discord needs the code sent to the email (A6), not the Discord login itself.
    await page.getByTestId("account-discord-disconnect").click();
    await expect(page.getByTestId("account-confirm-discord")).toBeVisible();
    await page.getByTestId("account-code").fill(await codeFor("discord@example.com"));
    await page.getByTestId("account-confirm-discord").click();
    await expect(page.getByTestId("account-discord-connect")).toBeVisible();

    // Connecting it again needs a code to the email too, then the Discord sign-in in the browser.
    await page.getByTestId("account-discord-connect").click();
    await expect(page.getByTestId("account-confirm-discord")).toBeVisible();
    await page.getByTestId("account-code").fill(await codeFor("discord@example.com"));
    await page.getByTestId("account-confirm-discord").click();
    await expect(page.getByTestId("account-discord")).toContainText("@pretend_user");

    // Moved to another address, the email can then be removed with a code sent to it; Discord stays the way in.
    await page.getByTestId("account-change-email").click();
    await page.getByTestId("account-new-email").fill("second@example.com");
    await page.getByTestId("account-email-code").click();
    await expect(page.getByTestId("account-confirm-email")).toBeVisible();
    await page.getByTestId("account-code").fill(await codeFor("second@example.com"));
    await page.getByTestId("account-confirm-email").click();
    await expect(page.getByTestId("account")).toContainText("second@example.com");
    await page.getByTestId("account-remove-email").click();
    await expect(page.getByTestId("account-confirm-remove-email")).toBeVisible();
    await page.getByTestId("account-code").fill(await codeFor("second@example.com"));
    await page.getByTestId("account-confirm-remove-email").click();
    await expect(page.getByTestId("account")).not.toContainText("second@example.com");
    await expect(page.getByTestId("account-discord")).toContainText("@pretend_user");

    await page.getByTestId("account-sign-out").click();
    await expect(page.getByTestId("account-email")).toBeVisible();
  } finally {
    await app.close();
  }
});
/** A built module's folder, ready for the pack command. */
async function moduleProject(id: string): Promise<string> {
  const project = await mkdtemp(path.join(tmpdir(), "tavora-module-"));
  await mkdir(path.join(project, "dist"));
  await writeFile(path.join(project, "dist", "index.html"), "<p>hi</p>");
  const manifest = { id, name: "Tracker", version: "1.0.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } };
  await writeFile(path.join(project, "tavora.module.json"), JSON.stringify(manifest));
  return project;
}

/** Runs the real pack command from its sources. */
function tavoraPack(args: string[], env: Record<string, string> = {}): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--conditions=source", path.resolve(desktopDir, "../../packages/pack/src/cli.ts"), ...args], { env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk));
    child.on("close", (status) => resolve({ status, out }));
  });
}

test("a developer chooses a public name and links a key file with tavora-pack link", async () => {
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: apiUrl } });
  const keyFile = path.join(await mkdtemp(path.join(tmpdir(), "tavora-key-")), "publisher-key.pem");
  await writeFile(keyFile, generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));
  const project = await moduleProject("keyfile.tracker");
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-account").click();
    await page.getByTestId("account-email").fill("developer@example.com");
    await page.getByTestId("account-send-code").click();
    await page.getByTestId("account-code").fill(await codeFor("developer@example.com"));
    await page.getByTestId("account-verify").click();
    await page.getByTestId("account-age").check();
    await page.getByTestId("account-create").click();
    await expect(page.getByTestId("account-sign-out")).toBeVisible();

    // The developer settings are under Development > Publishing; linking a key file is part of publishing from CI.
    await page.getByTestId("settings-nav-development").click();
    // Not a developer yet: the tools show after Let's go.
    await page.getByTestId("development-start").click();
    await page.getByTestId("settings-nav-dev-publishing").click();
    const developer = page.getByTestId("account-developer");
    await expect(developer).toBeVisible();
    await page.getByTestId("developer-ci-toggle").click();
    // Linking needs a name first.
    await expect(page.getByTestId("account-link-code")).toBeDisabled();
    await expect(page.getByTestId("developer-keys-none")).toBeVisible();
    await page.getByTestId("account-developer-name").fill("Tavora Team");
    await page.getByTestId("account-developer-save").click();
    await expect(page.getByTestId("toast")).toContainText("can't be used");
    await page.getByTestId("account-developer-name").fill("example-dev");
    await page.getByTestId("account-developer-save").click();
    await expect(page.getByTestId("account-developer-name-hint")).toContainText("can change it again on");

    // A one-time code, and the command that uses it.
    await page.getByTestId("account-link-code").click();
    const command = (await page.getByTestId("account-link-command").textContent()) ?? "";
    expect(command).toMatch(/^npx @tavora\/pack link [A-Z2-9]{4}-[A-Z2-9]{4} --key <key file>$/);
    const code = command.split(" ")[3]!;

    // The real pack command signs the code with a key on this PC and sends only its public half.
    const linked = await tavoraPack(["link", code, "--key", keyFile, "--api", apiUrl]);
    expect(linked.out).toContain('"by example-dev"');
    expect(linked.status).toBe(0);
    const fingerprint = /Linked publisher key ([0-9a-f]{32})/.exec(linked.out)?.[1] ?? "";

    await page.getByTestId("account-link-refresh").click();
    await expect(page.getByTestId(`account-key-${fingerprint}`)).toBeVisible();
    await expect(page.getByTestId("account-link")).toHaveCount(0);
    // Users' Tavora learns the name, and nothing else.
    expect(await (await fetch(`${apiUrl}/v1/publishers/${fingerprint}`)).json()).toEqual({ name: "example-dev" });

    // The key file alone publishes nothing: it needs a publish token, made here and shown once.
    const out = path.join(project, "out.zip");
    const packed = await tavoraPack([project, "--key", keyFile, "--out", out]);
    expect(packed.status, packed.out).toBe(0);
    const keyOnly = await tavoraPack(["publish", out, "--key", keyFile, "--api", apiUrl], { TAVORA_PUBLISH_TOKEN: "" });
    expect(keyOnly.out).toContain("Publishing needs your Tavora account");
    await page.getByTestId("publish-token-name").fill("GitHub Actions");
    await page.getByTestId("publish-token-create").click();
    const secret = (await page.getByTestId("publish-token-secret").textContent()) ?? "";
    expect(secret).toMatch(/^tvp_/);
    await page.getByTestId("publish-token-done").click();
    await expect(page.getByTestId("publish-token-secret")).toHaveCount(0);
    await expect(page.getByTestId("publish-tokens-list")).toContainText("GitHub Actions");
    // A token publishes only under prefixes the account has; this one is new.
    const withToken = await tavoraPack(["publish", out, "--key", keyFile, "--api", apiUrl], { TAVORA_PUBLISH_TOKEN: secret });
    expect(withToken.out).toContain("Publish this module's first version from Tavora");
  } finally {
    await app.close();
    await rm(path.dirname(keyFile), { recursive: true, force: true }).catch(() => undefined);
    await rm(project, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Tavora keeps a developer's publisher key, and tavora-pack without a key file points to Tavora", async () => {
  // A pretend Discord app turns on the test key store on Linux, which has no keyring here; the account's key needs one.
  const { app, page } = await launch(undefined, [], {
    env: { TAVORA_API_URL: apiUrl, TAVORA_DISCORD_IPC: path.join(tmpdir(), "tavora-no-discord"), TAVORA_DISCORD_TOKEN_URL: `${discordUrl}/api/oauth2/token` },
  });
  // Under the prefix that saving the name claims; the test before took exampledev for its own account.
  const project = await moduleProject("keykeeper.tracker");
  try {
    await signIn(page, "keeper@example.com", true);
    await page.getByTestId("settings-nav-development").click();
    await page.getByTestId("development-start").click();
    await page.getByTestId("settings-nav-dev-publishing").click();
    await page.getByTestId("developer-ci-toggle").click();
    await expect(page.getByTestId("developer-keys-none")).toBeVisible();
    await expect(page.getByTestId("developer-key-create")).toBeDisabled();
    // Saving the name makes the key and claims the name's prefix.
    await page.getByTestId("account-developer-name").fill("key-keeper");
    await expect(page.getByTestId("account-developer-name-prefix")).toContainText("keykeeper");
    await page.getByTestId("account-developer-save").click();
    await expect(page.getByTestId("developer-prefixes-list")).toContainText("keykeeper");
    // The account had no key yet: its recovery key is shown once, in its own group, and can be shown again.
    const recovery = page.getByTestId("recovery-key-text");
    await expect(recovery).toHaveText(/^[0-9A-Z-]{40,}$/);
    const recoveryKey = await recovery.textContent();
    await page.getByTestId("recovery-key-saved").click();
    await page.getByTestId("settings-nav-account").click();
    await page.getByTestId("recovery-key-show").click();
    await expect(recovery).toHaveText(recoveryKey!);
    await page.getByTestId("recovery-key-saved").click();
    await page.getByTestId("settings-nav-dev-publishing").click();
    await page.getByTestId("developer-ci-toggle").click();
    const kept = page.getByTestId("developer-keys-list").locator("li");
    await expect(kept).toHaveCount(1);
    const fingerprint = ((await kept.getAttribute("data-testid")) ?? "").replace("developer-key-", "");
    await expect(page.getByTestId(`account-key-${fingerprint}`)).toBeVisible();

    // Tavora signs only for its own Publish button: the pack command needs a key file.
    for (const args of [[project], ["publish", path.join(project, "out.zip")]]) {
      const run = await tavoraPack(args);
      expect(run.status).toBe(2);
      expect(run.out).toContain("Publish from Tavora: Settings > Your modules");
    }
  } finally {
    await app.close();
    await rm(project, { recursive: true, force: true }).catch(() => undefined);
  }
});

/** Signs in to an account that exists already, from Settings > Account. */
async function signIn(page: import("@playwright/test").Page, email: string, create = false) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-account").click();
  await page.getByTestId("account-email").fill(email);
  await page.getByTestId("account-send-code").click();
  await expect(page.getByTestId("account-code-sent")).toContainText(email);
  await page.getByTestId("account-code").fill(await codeFor(email));
  await page.getByTestId("account-verify").click();
  if (create) {
    await page.getByTestId("account-age").check();
    await page.getByTestId("account-create").click();
  }
  await expect(page.getByTestId("account-methods")).toContainText(email);
}

test("the cloud copy takes one PC's workspaces to another, with the recovery key", async () => {
  // Three starts of Tavora.
  test.setTimeout(120_000);
  // A pretend Discord app turns on the test key store on Linux, which has no keyring here; the copy key needs one.
  const env = { TAVORA_API_URL: apiUrl, TAVORA_DISCORD_IPC: path.join(tmpdir(), "tavora-no-discord"), TAVORA_DISCORD_TOKEN_URL: `${discordUrl}/api/oauth2/token` };
  // PC A has two games; it turns the copy on and keeps the recovery key.
  const a = await launch(undefined, [], { env });
  let key = "";
  try {
    await signIn(a.page, "copy@example.com", true);
    await a.page.getByTestId("cloud-copy-on").click();
    await expect(a.page.getByTestId("cloud-copy-key-text")).toBeVisible();
    key = (await a.page.getByTestId("cloud-copy-key-text").textContent()) ?? "";
    await a.page.getByTestId("cloud-copy-key-saved").click();
    await expect(a.page.getByTestId("cloud-copy-status")).toContainText("Saved");
  } finally {
    await a.app.close();
  }

  // PC B has no games yet; with A's key it takes the copy, and Tavora restarts.
  const b = await launch(undefined, [], { env, seed: false });
  try {
    await signIn(b.page, "copy@example.com");
    // The account has a recovery key: signing in asks for it, and it can wait.
    await b.page.getByTestId("recovery-ask-later").click();
    await expect(b.page.getByTestId("recovery-ask")).toHaveCount(0);
    await b.page.getByTestId("cloud-copy-on").click();
    await b.page.getByTestId("cloud-copy-key-input").fill(key);
    await b.page.getByTestId("cloud-copy-key-submit").click();
    await expect(b.page.getByTestId("cloud-copy-question")).toContainText("Which data do you want to keep?");
    // The test starts Tavora again itself.
    await b.app.evaluate(({ app }) => {
      app.relaunch = () => undefined;
    });
    const exited = new Promise<void>((resolve) => b.app.process().once("exit", () => resolve()));
    await b.page.getByTestId("cloud-copy-keep-cloud").click();
    await exited;
  } catch (error) {
    await b.app.close();
    throw error;
  }
  const again = await launch(b.userData, [], { env, seed: false });
  try {
    await expect(again.page.getByTestId("rail-workspace-poe2")).toBeVisible();
    await expect(again.page.getByTestId("rail-workspace-satisfactory")).toBeVisible();
  } finally {
    await again.app.close();
  }
});

test("a new PC gets the recovery key from another PC, once both show the same code", async () => {
  // The old PC looks for new ones every few seconds.
  test.setTimeout(120_000);
  const env = { TAVORA_API_URL: apiUrl, TAVORA_DISCORD_IPC: path.join(tmpdir(), "tavora-no-discord"), TAVORA_DISCORD_TOKEN_URL: `${discordUrl}/api/oauth2/token` };
  const a = await launch(undefined, [], { env });
  const b = await launch(undefined, [], { env, seed: false });
  try {
    await signIn(a.page, "pair@example.com", true);
    await a.page.getByTestId("cloud-copy-on").click();
    await expect(a.page.getByTestId("cloud-copy-key-text")).toBeVisible();
    const key = (await a.page.getByTestId("cloud-copy-key-text").textContent())?.trim() ?? "";
    await a.page.getByTestId("cloud-copy-key-saved").click();

    // Signing in on B asks for the account's recovery key right away.
    await signIn(b.page, "pair@example.com");
    const ask = b.page.getByTestId("recovery-ask");
    await ask.getByTestId("pairing-start").click();
    await expect(ask.getByTestId("pairing-start")).toHaveCount(0);
    await expect(ask.getByTestId("pairing-code")).toBeVisible({ timeout: 40_000 });
    const code = (await ask.getByTestId("pairing-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^.{3}-.{3}$/);
    await expect(a.page.getByTestId("pairing-approve")).toContainText("Add");
    await expect(a.page.getByTestId("pairing-approve-code")).toHaveText(code, { timeout: 20_000 });
    await a.page.getByTestId("pairing-add").click();
    await expect(a.page.getByTestId("pairing-approve")).toHaveCount(0);

    // B now has the account's key without anyone typing it, and the question is gone.
    await expect(ask).toHaveCount(0, { timeout: 15_000 });
    await expect(b.page.getByTestId("recovery-key-show")).toBeVisible({ timeout: 15_000 });
    await b.page.getByTestId("recovery-key-show").click();
    await expect(b.page.getByTestId("recovery-key-text")).toHaveText(key);
  } finally {
    await a.app.close();
    await b.app.close();
  }
});

/** A stand-in for the network between Tavora and the service: it passes everything on until it is stopped, and can start again. */
async function flakyLink(target: number) {
  const port = await freePort();
  const open = new Set<Socket>();
  const server = createServer((from) => {
    const to = createConnection(target, "127.0.0.1");
    for (const socket of [from, to]) {
      open.add(socket);
      socket.on("close", () => open.delete(socket));
      socket.on("error", () => socket.destroy());
    }
    from.pipe(to);
    to.pipe(from);
  });
  const start = () => new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const stop = () =>
    new Promise<void>((resolve) => {
      for (const socket of open) socket.destroy();
      server.close(() => resolve());
    });
  await start();
  return { url: `http://127.0.0.1:${port}`, start, stop };
}

test("when the cloud can't be reached the copy says so and Try again works once it is back", async () => {
  test.setTimeout(120_000);
  const link = await flakyLink(Number(new URL(apiUrl).port));
  const env = { TAVORA_API_URL: link.url, TAVORA_DISCORD_IPC: path.join(tmpdir(), "tavora-no-discord"), TAVORA_DISCORD_TOKEN_URL: `${discordUrl}/api/oauth2/token` };
  const a = await launch(undefined, [], { env });
  try {
    await signIn(a.page, "offline@example.com", true);
    await a.page.getByTestId("cloud-copy-on").click();
    await a.page.getByTestId("cloud-copy-key-saved").click();
    await expect(a.page.getByTestId("cloud-copy-status")).toContainText("Saved");
    await expect(a.page.getByTestId("cloud-copy-problem")).toHaveCount(0);

    // Something changes while the connection is gone: the upload fails, and says why and what to do.
    await link.stop();
    await a.page.evaluate(() => (window as unknown as { tavoraHost: { act(action: unknown): Promise<unknown> } }).tavoraHost.act({ type: "rename-workspace", workspaceId: "poe2", name: "Renamed" }));
    await a.page.getByTestId("cloud-copy-upload").click();
    const problem = a.page.getByTestId("cloud-copy-problem");
    await expect(problem).toContainText("Cloud copy isn't syncing");
    await expect(problem).toContainText("Can't reach the cloud. Check your connection.");

    await link.start();
    await a.page.getByTestId("cloud-copy-retry").click();
    await expect(problem).toHaveCount(0);
    await expect(a.page.getByTestId("cloud-copy-status")).toContainText("Saved");
  } finally {
    await a.app.close();
    await link.stop();
  }
});

test("a cloud copy in a folder that went missing says so and offers another folder", async () => {
  test.setTimeout(120_000);
  const env = { TAVORA_API_URL: apiUrl, TAVORA_DISCORD_IPC: path.join(tmpdir(), "tavora-no-discord"), TAVORA_DISCORD_TOKEN_URL: `${discordUrl}/api/oauth2/token` };
  const a = await launch(undefined, [], { env });
  const folder = path.join(a.userData, "my-cloud-folder");
  await mkdir(folder);
  const pick = (picked: string) =>
    a.app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as unknown as typeof dialog.showOpenDialog;
    }, picked);
  try {
    await a.page.getByTestId("rail-settings").click();
    await a.page.getByTestId("settings-nav-account").click();

    // A folder that isn't there at the start: nothing turns on, and the user hears why.
    await pick(path.join(a.userData, "never-existed"));
    await a.page.getByTestId("cloud-copy-on-folder").click();
    await expect(a.page.getByTestId("toast")).toHaveText("Can't find your folder. Is it still there? You can pick another one.");
    await expect(a.page.getByTestId("cloud-copy-on-folder")).toBeVisible();

    // A folder that works, then goes missing: the next upload fails and the problem box offers Change folder.
    await pick(folder);
    await a.page.getByTestId("cloud-copy-on-folder").click();
    await a.page.getByTestId("cloud-copy-key-saved").click();
    await expect(a.page.getByTestId("cloud-copy-status")).toContainText("Saved");
    await rm(folder, { recursive: true, force: true });
    await a.page.evaluate(() => (window as unknown as { tavoraHost: { act(action: unknown): Promise<unknown> } }).tavoraHost.act({ type: "rename-workspace", workspaceId: "poe2", name: "Renamed" }));
    await a.page.getByTestId("cloud-copy-upload").click();
    const problem = a.page.getByTestId("cloud-copy-problem");
    await expect(problem).toContainText("Can't find your folder");
    await expect(a.page.getByTestId("cloud-copy-retry")).toHaveText("Change folder…");
  } finally {
    await a.app.close();
  }
});
