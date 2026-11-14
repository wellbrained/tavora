// End-to-end check of signed app updates (CoreHub #476), for Windows CI only: it installs and quits Tavora, so
// never on a PC someone uses. A bug in the signature check could leave every installed Tavora on its version for
// good, so this runs the real chain: two packaged versions, the real electron-updater, a local feed (serve-feed.mjs)
// and throwaway keys made for this run.
//
//   node apps/desktop/scripts/update-check.mjs prepare <work folder>
//     Makes throwaway release, backup and stranger keys in the work folder and pins the first two in
//     src/main/update-keys.ts (CI only: it rewrites that file). Then build (pnpm build), then:
//   node apps/desktop/scripts/update-check.mjs run <work folder>
//     Packages this version (A) and the next (B) with the local feed's address, installs A like a user and
//     starts it against one feed after another:
//       unsigned latest.yml, a signature by a key the app does not pin, a changed installer under a genuine
//       signature, and a genuine signature relabelled as a newer version: each refused, A keeps running, and
//       quitting installs nothing;
//       signed by the backup key: checked (then killed, so nothing installs);
//       signed by the release key: checked, and quitting installs B, which then starts.
import { spawn, spawnSync } from "node:child_process";
import { createHash, createPrivateKey } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeUpdateKey, signUpdate } from "../src/main/update-signature.ts";
import { checkStart, visibleWindows } from "./start-check.mjs";
import { addSignatureToLatestYml } from "./update-feed.mjs";

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(path.dirname(desktop));
const keysFile = path.join(desktop, "src", "main", "update-keys.ts");
const PORT = 8765;
const FEED = `http://127.0.0.1:${PORT}`;
const installed = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Tavora");
const exe = path.join(installed, "Tavora.exe");
const updatesLog = path.join(process.env.APPDATA ?? "", "@tavora", "desktop", "updates.log");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha512 = (file) => createHash("sha512").update(readFileSync(file)).digest("base64");
const say = (text) => console.log(`\n== ${text}`);

class CheckFailed extends Error {}
function fail(message) {
  throw new CheckFailed(message);
}

/** The next patch version. */
export function nextPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/** latest.yml with every SHA-512 of the installer (the top-level one and the files list's) swapped for another. */
export function swapSha512(latestYml, from, to) {
  if (!latestYml.includes(from)) throw new Error("latest.yml does not have that SHA-512");
  return latestYml.split(from).join(to);
}

/** latest.yml that says another version (the files stay the same). */
export function relabel(latestYml, from, to) {
  if (!latestYml.includes(`version: ${from}\n`) && !latestYml.includes(`version: ${from}\r\n`)) throw new Error(`latest.yml does not say version ${from}`);
  return latestYml.replace(/^version: .*$/m, `version: ${to}`);
}

/** Both steps change this PC (the pinned keys; an installed Tavora and its data), so they run on CI unless forced. */
function onlyOnCi(step) {
  if (process.env.CI !== "true" && !process.argv.includes("--force")) {
    fail(`${step} It runs on CI only; --force runs it anyway, on a machine nobody uses.`);
  }
}

function prepare(work) {
  onlyOnCi("prepare rewrites src/main/update-keys.ts with throwaway keys (git checkout that file afterwards).");
  mkdirSync(work, { recursive: true });
  const keys = {};
  for (const name of ["release", "backup", "stranger"]) {
    const { privateKey, publicKey } = makeUpdateKey();
    writeFileSync(path.join(work, `${name}.pem`), privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
    keys[name] = publicKey;
  }
  writeFileSync(
    keysFile,
    [
      "// Throwaway keys of one update-check.mjs run (CI only). Never committed: the real keys are in git.",
      "export const PINNED_UPDATE_KEYS = {",
      `  release: "${keys.release}",`,
      `  backup: "${keys.backup}",`,
      "};",
      "",
    ].join("\n"),
  );
  console.log(`Pinned throwaway keys for this run: release ${keys.release}, backup ${keys.backup} (stranger ${keys.stranger} is not pinned).`);
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: repo, stdio: "inherit", shell: process.platform === "win32" && !path.isAbsolute(command), ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed (exit ${result.status}).`);
}

/** Packages the built app at `version` for the local feed; returns where its installer and latest.yml went. */
function packageVersion(version, out) {
  const packageJson = path.join(desktop, "package.json");
  const original = readFileSync(packageJson, "utf8");
  const current = JSON.parse(original).version;
  try {
    if (version !== current) writeFileSync(packageJson, original.replace(`"version": "${current}"`, `"version": "${version}"`));
    rmSync(path.join(desktop, "release"), { recursive: true, force: true });
    run("pnpm", ["--filter", "@tavora/desktop", "package", "--win", "nsis", "--publish", "never", "-c.publish.provider=generic", `-c.publish.url=${FEED}`]);
  } finally {
    writeFileSync(packageJson, original);
  }
  const release = path.join(desktop, "release");
  const feedConfig = readFileSync(path.join(release, "win-unpacked", "resources", "app-update.yml"), "utf8");
  if (!feedConfig.includes(`url: ${FEED}`)) fail(`The package's app-update.yml does not point at ${FEED}:\n${feedConfig}`);
  mkdirSync(out, { recursive: true });
  const installer = `Tavora-Setup-${version}.exe`;
  for (const name of [installer, `${installer}.blockmap`, "latest.yml"]) copyFileSync(path.join(release, name), path.join(out, name));
  return { installer: path.join(out, installer), blockmap: path.join(out, `${installer}.blockmap`), latestYml: readFileSync(path.join(out, "latest.yml"), "utf8") };
}

function installedVersion() {
  try {
    return JSON.parse(readFileSync(path.join(installed, "resources", "app", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

/** Whether a process with this image name runs. */
function running(image) {
  const result = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], { encoding: "utf8" });
  return (result.stdout ?? "").toLowerCase().includes(image.toLowerCase());
}
const tavoraRunning = () => running("Tavora.exe");

async function waitFor(what, test, timeoutMs, everyMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await test();
    if (value) return value;
    await sleep(everyMs);
  }
  fail(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${what}.`);
}

function readLog() {
  try {
    return readFileSync(updatesLog, "utf8");
  } catch {
    return "";
  }
}

/** Serves `folder` on the test port with serve-feed.mjs until stopped. */
async function serve(folder) {
  const child = spawn(process.execPath, [path.join(desktop, "scripts", "serve-feed.mjs"), String(PORT), folder], { stdio: ["ignore", "pipe", "inherit"] });
  let printed = "";
  child.stdout.on("data", (chunk) => {
    printed += chunk;
    process.stdout.write(`  [feed] ${chunk}`);
  });
  await waitFor("the test feed", () => printed.includes("Test feed on"), 10_000, 100);
  return child;
}

/**
 * Starts the installed Tavora against the feed in `feed`, waits for the updates.log line `expect`, then checks it
 * still runs with its window up, and ends it: "quit" closes it the way a user does, "kill" ends it at once.
 */
async function scenario(name, { files, expect, end }) {
  say(name);
  const feed = path.join(work, "feed");
  rmSync(feed, { recursive: true, force: true });
  mkdirSync(feed, { recursive: true });
  for (const [to, from] of Object.entries(files)) {
    if (typeof from === "string" && existsSync(from)) copyFileSync(from, path.join(feed, to));
    else writeFileSync(path.join(feed, to), from);
  }
  rmSync(updatesLog, { force: true });
  const server = await serve(feed);
  const app = spawn(exe, [], { stdio: "ignore" });
  let exit = null;
  app.on("exit", (code) => (exit = code ?? -1));
  try {
    await waitFor(`updates.log to say ${expect}`, () => {
      if (exit !== null) fail(`Tavora quit (exit ${exit}) before the update was checked.\n${readLog()}`);
      return expect.test(readLog());
    }, 4 * 60_000);
    console.log(readLog().trim());
    // The app goes on with its version: still running, its window up.
    if (exit !== null) fail(`Tavora quit (exit ${exit}) after checking the update.`);
    await waitFor("Tavora's window", () => visibleWindows(exe).some((w) => w.cls === "Chrome_WidgetWin_1" && w.title === "Tavora"), 60_000);
    if (end === "kill") {
      spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      // Closing the window (WM_CLOSE, as a click on X) quits Tavora cleanly, which is when an update installs.
      spawnSync("taskkill", ["/PID", String(app.pid)], { stdio: "inherit" });
    }
    await waitFor("Tavora to quit", () => exit !== null, 60_000, 250);
    if (end === "quit" && exit !== 0) fail(`Tavora quit with exit code ${exit}, not 0.`);
    await waitFor("every Tavora process to end", () => !tavoraRunning(), 60_000);
  } finally {
    if (exit === null) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    server.kill();
  }
}

async function check(work) {
  onlyOnCi("run installs Tavora over the one on this PC and starts and quits it again and again.");
  if (process.platform !== "win32") fail("update-check runs on Windows only.");
  const keys = Object.fromEntries(["release", "backup", "stranger"].map((name) => [name, createPrivateKey(readFileSync(path.join(work, `${name}.pem`), "utf8"))]));
  const { PINNED_UPDATE_KEYS } = await import("../src/main/update-keys.ts");
  const bundle = readFileSync(path.join(desktop, "out", "main", "index.cjs"), "utf8");
  if (!bundle.includes(PINNED_UPDATE_KEYS.release) || !bundle.includes(PINNED_UPDATE_KEYS.backup)) fail("The built app does not pin this run's test keys: run prepare, then pnpm build, then run.");

  const a = JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8")).version;
  const b = nextPatch(a);
  const later = nextPatch(b);
  say(`Packaging ${a} and ${b} for ${FEED}`);
  const first = packageVersion(a, path.join(work, a));
  const second = packageVersion(b, path.join(work, b));

  say(`Installing ${a} like a user`);
  if (tavoraRunning()) fail("A Tavora is running already.");
  run(first.installer, ["/S"]);
  await waitFor(`the installed version to be ${a}`, () => installedVersion() === a, 60_000);

  const name = path.basename(second.installer);
  const genuine = { version: b, file: name, sha512: sha512(second.installer) };
  const signed = (key, latestYml = second.latestYml) => addSignatureToLatestYml(latestYml, signUpdate(genuine, key));
  const realFiles = { [name]: second.installer, [`${name}.blockmap`]: second.blockmap, [path.basename(first.blockmap)]: first.blockmap };
  const stillA = async () => {
    // Nothing installs after a refused version, not even on a clean quit.
    await sleep(20_000);
    if (installedVersion() !== a) fail(`The installed version is ${installedVersion()}, not ${a}: a refused update was installed.`);
  };

  await scenario("An unsigned latest.yml is refused", { files: { ...realFiles, "latest.yml": second.latestYml }, expect: new RegExp(`update ${b} refused: latest\\.yml has no Tavora signature`), end: "quit" });
  await stillA();

  await scenario("A signature by a key the app does not pin is refused", { files: { ...realFiles, "latest.yml": signed(keys.stranger) }, expect: new RegExp(`update ${b} refused: the Tavora signature does not match`), end: "quit" });
  await stillA();

  // A changed installer that latest.yml describes correctly (so electron-updater's own SHA-512 check passes), under the genuine signature.
  const tampered = path.join(work, "tampered", name);
  mkdirSync(path.dirname(tampered), { recursive: true });
  const bytes = readFileSync(second.installer);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  writeFileSync(tampered, bytes);
  const tamperedYml = swapSha512(second.latestYml, genuine.sha512, sha512(tampered));
  await scenario("A changed installer under a genuine signature is refused", { files: { [name]: tampered, "latest.yml": signed(keys.release, tamperedYml) }, expect: new RegExp(`update ${b} refused: the Tavora signature does not match`), end: "quit" });
  await stillA();

  await scenario("A genuine signature relabelled as a newer version is refused", { files: { ...realFiles, "latest.yml": relabel(signed(keys.release), b, later) }, expect: new RegExp(`update ${later} refused: the Tavora signature does not match`), end: "quit" });
  await stillA();

  await scenario("A signature by the backup key is taken", { files: { ...realFiles, "latest.yml": signed(keys.backup) }, expect: new RegExp(`update ${b} signature checked \\(backup key\\)`), end: "kill" });
  if (installedVersion() !== a) fail(`The installed version is ${installedVersion()} after a kill, not ${a}.`);

  await scenario("A signature by the release key is taken, and quitting installs it", { files: { ...realFiles, "latest.yml": signed(keys.release) }, expect: new RegExp(`update ${b} signature checked \\(release key\\)`), end: "quit" });
  await waitFor(`the installed version to become ${b}`, () => installedVersion() === b, 4 * 60_000, 2000);
  await waitFor("the installer to finish", () => !running(name) && !tavoraRunning(), 2 * 60_000, 2000);
  say(`${b} is installed; starting it`);
  await checkStart(exe);
  console.log(`\nSigned updates hold end to end: ${a} refused four bad feeds, took the backup and the release key, and installed ${b} on quit.`);
}

const [command, work] = [process.argv[2], process.argv[3] ? path.resolve(process.argv[3]) : null];
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!work || !["prepare", "run"].includes(command)) {
      console.error("usage: node scripts/update-check.mjs prepare|run <work folder>");
      process.exit(2);
    }
    if (command === "prepare") prepare(work);
    else await check(work);
  } catch (error) {
    console.error(`\nupdate-check failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!(error instanceof CheckFailed) && error instanceof Error) console.error(error.stack);
    const log = command === "run" && process.env.CI === "true" ? readLog() : "";
    if (log) console.error(`\nupdates.log:\n${log}`);
    process.exit(1);
  }
}
