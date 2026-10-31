// For the maintainer: sends the server setup (deploy/server/setup-deploy-access.sh and every file it installs)
// to the server and runs it there as root, with the root admin key. Only committed files go (HEAD), plus the
// four deploy keys' public halves and this PC's tailnet address. See deploy/README.md.
//
//   node deploy/send-server-setup.mjs --admin-key <path to the root admin key> [--pc-address 100.x.y.z]
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JOBS } from "../scripts/deploy-client.mjs";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PATHS = ["deploy/server", "apps/api/deploy"];

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} ${args[0]} failed (exit ${result.status}). ${result.stderr ?? ""}`.trim());
  return result.stdout;
}

const adminKey = option("--admin-key");
const pc = option("--pc-address", "100.112.174.10");
const host = (process.env.TAVORA_DEPLOY_HOST ?? "").trim();
if (!adminKey || !existsSync(adminKey)) fail("Usage: node deploy/send-server-setup.mjs --admin-key <path to the root admin key>");
if (!/^[A-Za-z0-9.-]+$/.test(host)) fail("Set TAVORA_DEPLOY_HOST to the server's tailnet name (no user) first.");
if (!/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pc)) fail(`Not a tailnet address: ${pc}`);
if (run("git", ["status", "--porcelain", "--", ...PATHS]).trim()) fail(`Commit the changes in ${PATHS.join(" and ")} first: only committed files are sent.`);

const work = mkdtempSync(path.join(tmpdir(), "tavora-server-setup-"));
try {
  const tree = path.join(work, "tree");
  mkdirSync(path.join(tree, "keys"), { recursive: true });
  // git archive: exactly the committed bytes (LF endings), the same ones deploys compare with.
  const archive = path.join(work, "head.tar");
  run("git", ["archive", "--format=tar", "-o", archive, "HEAD", "--", ...PATHS]);
  const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  run(tar, ["-xf", archive, "-C", tree]);
  for (const { user, keyVar } of Object.values(JOBS)) {
    const key = (process.env[keyVar] ?? "").trim();
    if (!key) fail(`Set ${keyVar} to the ${user} key first (deploy/README.md).`);
    if (!existsSync(`${key}.pub`)) fail(`No public key next to ${keyVar}: ${key}.pub`);
    copyFileSync(`${key}.pub`, path.join(tree, "keys", `${user}.pub`));
  }
  writeFileSync(path.join(tree, "pc-address"), `${pc}\n`);
  const bundle = path.join(work, "setup.tar");
  run(tar, ["-cf", bundle, "-C", tree, "."]);

  const commit = run("git", ["rev-parse", "--short=12", "HEAD"]).trim();
  console.log(`Sending the server setup from ${commit} to root@${host} (deploy keys only from ${pc}).`);
  const remote = 'd="$(mktemp -d)" && tar -xf - -C "$d" && bash "$d/deploy/server/setup-deploy-access.sh" "$d"; rc=$?; rm -rf "$d"; exit $rc';
  const input = openSync(bundle, "r");
  try {
    const result = spawnSync(
      "ssh.exe",
      ["-i", adminKey, "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "-T", `root@${host}`, remote],
      { stdio: [input, "inherit", "inherit"] },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) fail(`The setup stopped (exit ${result.status}); see its message above. What it said it did before that stays done; run it again after fixing.`);
  } finally {
    closeSync(input);
  }
  console.log("Server setup done. Check the keys with: node scripts/deploy-client.mjs hello");
} finally {
  rmSync(work, { recursive: true, force: true });
}
