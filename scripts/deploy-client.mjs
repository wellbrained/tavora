// Talks to the server's tavora-receive (deploy/server/tavora-receive) for every Tavora deploy: one restricted
// key and user per job, set up by deploy/server/setup-deploy-access.sh (decided 2026-10-31, CoreHub #421).
//
//   node scripts/deploy-client.mjs hello [job ...]          checks the keys and the server setup (all jobs if none given)
//   node scripts/deploy-client.mjs publish <job> <id> <tar> uploads a tar for one job
//
// Settings from the maintainer's environment: TAVORA_DEPLOY_HOST (the server's tailnet name, no user) and
// one key per job (below). The old TAVORA_DEPLOY_SSH_KEY (a root key) is refused.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROTOCOL = 1;

/** Each job's server user, its key setting, and the setup files whose server copy must match the repo. */
export const JOBS = {
  updates: { user: "tavora-updates", keyVar: "TAVORA_UPDATES_SSH_KEY", needs: [/^deploy\/server\/tavora-receive$/] },
  docs: { user: "tavora-docs", keyVar: "TAVORA_DOCS_SSH_KEY", needs: [/^deploy\/server\/tavora-receive$/] },
  api: {
    user: "tavora-api-deploy",
    keyVar: "TAVORA_API_SSH_KEY",
    needs: [/^deploy\/server\/tavora-receive$/, /^deploy\/server\/tavora-api-switch$/, /^apps\/api\/deploy\//],
  },
  admin: {
    user: "tavora-admin-deploy",
    keyVar: "TAVORA_ADMIN_SSH_KEY",
    needs: [/^deploy\/server\/tavora-receive$/, /^deploy\/server\/tavora-admin-switch$/],
  },
};

const SETUP_HINT = "Run the server setup again (deploy/README.md, \"Change the server setup\").";

/** Where and how to reach `job`, or the problems that stand in the way. */
export function target(env, job) {
  const spec = JOBS[job];
  if (!spec) return { problems: [`Unknown deploy job "${job}" (one of ${Object.keys(JOBS).join(", ")}).`] };
  const problems = [];
  const host = (env.TAVORA_DEPLOY_HOST ?? "").trim();
  const key = (env[spec.keyVar] ?? "").trim();
  if (!host) problems.push("Set TAVORA_DEPLOY_HOST to the server's tailnet name (see deploy/README.md).");
  else if (!/^[A-Za-z0-9.-]+$/.test(host)) problems.push(`TAVORA_DEPLOY_HOST must be a host name only, without a user ("${host}").`);
  if (!key) problems.push(`Set ${spec.keyVar} to the path of the ${spec.user} key (see deploy/README.md).`);
  if (key && env.TAVORA_DEPLOY_SSH_KEY && path.resolve(key) === path.resolve(env.TAVORA_DEPLOY_SSH_KEY)) {
    problems.push(`${spec.keyVar} is the old root key (TAVORA_DEPLOY_SSH_KEY). Use the ${spec.user} key.`);
  }
  return { problems, host, key, user: spec.user };
}

/** Reads tavora-receive's answer to `hello`: the banner line, then "installed <sha256>  <repo path>" lines. */
export function parseHello(text, job) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  const banner = /^tavora-receive (\d+) ([a-z]+)$/.exec(lines[0] ?? "");
  if (!banner) {
    return { error: `The server did not answer as tavora-receive. This key may not be a restricted deploy key (did it open a shell?); use the ${JOBS[job]?.user ?? job} key.` };
  }
  if (Number(banner[1]) !== PROTOCOL) return { error: `The server's tavora-receive speaks protocol ${banner[1]}, this repo ${PROTOCOL}. ${SETUP_HINT}` };
  if (banner[2] !== job) return { error: `This key belongs to the ${banner[2]} job, not ${job}. Check ${JOBS[job]?.keyVar}.` };
  const installed = new Map();
  for (const line of lines.slice(1)) {
    const match = /^installed ([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (match) installed.set(match[2], match[1]);
  }
  return { installed };
}

/** The setup files `job` depends on whose server copy differs from the repo's (or is missing on either side). */
export function staleSetup(job, installed, repoHash) {
  const needs = JOBS[job].needs;
  const relevant = (file) => needs.some((pattern) => pattern.test(file));
  const stale = [];
  for (const [file, sha] of installed) if (relevant(file) && repoHash(file) !== sha) stale.push(file);
  if (![...installed.keys()].some((file) => /tavora-receive$/.test(file))) stale.push("deploy/server/tavora-receive");
  return stale.sort();
}

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** SHA-256 of a file as committed (HEAD), the same bytes the server setup was given; null if it isn't in HEAD. */
export function committedHash(file) {
  const result = spawnSync("git", ["-C", repo, "cat-file", "blob", `HEAD:${file}`], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) return null;
  return createHash("sha256").update(result.stdout).digest("hex");
}

function sshArgs({ key, user, host }, command) {
  return ["-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "-T", `${user}@${host}`, command];
}

/** Asks the server who answers for `job`; throws with a clear message when it isn't the right restricted key. */
export function hello(job, env = process.env) {
  const where = target(env, job);
  if (where.problems.length) throw new Error(where.problems.join("\n"));
  const result = spawnSync("ssh.exe", sshArgs(where, "hello"), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not reach ${where.user}@${where.host} (exit ${result.status}): ${String(result.stderr).trim()}`);
  const answer = parseHello(result.stdout, job);
  if (answer.error) throw new Error(answer.error);
  const stale = staleSetup(job, answer.installed, committedHash);
  if (stale.length) throw new Error(`The server's setup is older than this repo (${stale.join(", ")}). ${SETUP_HINT}`);
  return where;
}

/** Uploads `file` (a tar) for `job` as release or version `id`; tavora-receive checks and publishes it. */
export function publish(job, id, file, env = process.env) {
  if (!/^[0-9a-z.-]{1,40}$/.test(id)) throw new Error(`Not a release id: ${id}`);
  if (!existsSync(file)) throw new Error(`No file ${file}`);
  const where = hello(job, env);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  const input = openSync(file, "r");
  try {
    const result = spawnSync("ssh.exe", sshArgs(where, `publish ${id} ${sha}`), { stdio: [input, "inherit", "inherit"] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`The server did not publish ${id} (exit ${result.status}); see its message above.`);
  } finally {
    closeSync(input);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "hello") {
      const jobs = rest.length ? rest : Object.keys(JOBS);
      let failed = false;
      for (const job of jobs) {
        try {
          const where = hello(job);
          console.log(`${job}: OK (${where.user}@${where.host})`);
        } catch (error) {
          failed = true;
          console.error(`${job}: ${error.message}`);
        }
      }
      process.exit(failed ? 1 : 0);
    } else if (command === "publish" && rest.length === 3) {
      publish(rest[0], rest[1], rest[2]);
    } else {
      console.error("Usage: node scripts/deploy-client.mjs hello [job ...] | publish <job> <id> <tar>");
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
