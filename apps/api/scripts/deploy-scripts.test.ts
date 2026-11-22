import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript run by node on the server, no types
import { startFilter } from "../deploy/tavora-clamd-filter.mjs";

// The server's helper scripts (apps/api/deploy, and the update feed's DNS step), run here with bash against a temporary
// tree and fake commands, never against a server: the paths in each script are moved into the tree, and the commands
// that would touch the system (runuser, sqlite3, curl, systemctl, ...) are small fakes that log what they were given.
const deploy = path.dirname(path.dirname(fileURLToPath(import.meta.url))) + "/deploy";
const repo = path.resolve(deploy, "../../..");
const windows = process.platform === "win32";
/** A path as bash on this machine writes it (Git Bash on Windows: /c/Users/...). */
const bashPath = (file: string) => (windows ? file.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replace(/\\/g, "/") : file);

interface Tree {
  root: string;
  bin: string;
  log: string;
  /** The script as it would run on the server, with its paths moved into the tree. */
  script(source: string): string;
  run(script: string, args?: string[], options?: { input?: string; env?: Record<string, string> }): { status: number | null; out: string };
  read(name: string): string;
}

function tree(): Tree {
  const root = mkdtempSync(path.join(tmpdir(), "tavora-deploy-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "log");
  mkdirSync(bin);
  mkdirSync(log);
  const r = bashPath(root);
  const b = bashPath(bin);
  return {
    root,
    bin,
    log,
    script(source) {
      const text = readFileSync(path.join(repo, source), "utf8")
        .replaceAll("PATH=/usr/bin:/bin", `PATH=${b}:/usr/bin:/bin`)
        .replaceAll("/usr/local/bin/node", `${b}/node`)
        .replaceAll("/usr/local/sbin/tavora-api-set-setting", `${b}/tavora-api-set-setting`)
        .replaceAll("TMPDIR=/var/tmp", `TMPDIR=${r}/tmp`)
        .replace(/(?<![\w/])\/(var\/lib\/tavora-api|srv\/tavora-api|etc\/caddy)/g, `${r}/$1`);
      const file = path.join(root, path.basename(source));
      writeFileSync(file, text.replace(/\r\n/g, "\n"), { mode: 0o755 });
      return file;
    },
    run(script, args = [], { input = "", env = {} } = {}) {
      // PATH is set inside bash, so on Windows it stays a POSIX list.
      const result = spawnSync("bash", ["-c", 'PATH="$FAKE_BIN:$PATH"; exec bash "$0" "$@"', bashPath(script), ...args], {
        encoding: "utf8",
        input,
        env: { ...process.env, FAKE_BIN: b, ...env },
      });
      return { status: result.status, out: `${result.stdout}${result.stderr}` };
    },
    read(name) {
      const file = path.join(log, name);
      return existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
    },
  };
}

/** A fake command: a bash script in the tree's bin folder. `$LOG` in it is the tree's log folder. */
function fake(t: Tree, name: string, body: string): void {
  const file = path.join(t.bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\nLOG='${bashPath(t.log)}'\n${body}\n`, { mode: 0o755 });
  if (!windows) chmodSync(file, 0o755);
}

/** runuser: logs its first arguments (up to the env -i it must run), checks -u <user> --, and marks the time it runs a command, so fakes can tell. */
function fakeRunuser(t: Tree): void {
  fake(t, "runuser", `echo "$1 $2 $3 $4 $5" >> "$LOG/runuser"
[[ "$1" == -u && "$3" == -- ]] || exit 99
shift 3
touch "$LOG/inside"; "$@"; rc=$?; rm -f "$LOG/inside"; exit $rc`);
}

describe("the daily backup", () => {
  function setup() {
    const t = tree();
    fakeRunuser(t);
    // sqlite3 <db> ".backup '<file>'": copies the file, and says whether it ran as the service's user (under runuser).
    fake(t, "sqlite3", `where=outside; [[ -e "$LOG/inside" ]] && where=inside
echo "$where $1" >> "$LOG/sqlite3"
[[ -e "$LOG/fail-sqlite" ]] && exit 1
target="\${2#.backup \\'}"; target="\${target%\\'}"
cp "$1" "$target"`);
    const state = path.join(t.root, "var/lib/tavora-api");
    mkdirSync(path.join(state, "catalog/zips"), { recursive: true });
    mkdirSync(path.join(state, "catalog/lists"), { recursive: true });
    mkdirSync(path.join(t.root, "tmp"));
    writeFileSync(path.join(state, "accounts.sqlite"), "accounts");
    writeFileSync(path.join(state, "icons.sqlite"), "icons");
    writeFileSync(path.join(state, "catalog/catalog.sqlite"), "catalog");
    writeFileSync(path.join(state, "catalog/zips/abc.zip"), "zip");
    writeFileSync(path.join(state, "catalog/lists/revocations.json"), "{}");
    const backups = path.join(t.root, "srv/tavora-api/backups");
    mkdirSync(backups, { recursive: true });
    const old = path.join(backups, "tavora-api-20260101T031500Z.tar.gz");
    const recent = path.join(backups, "tavora-api-20260102T031500Z.tar.gz");
    writeFileSync(old, "old");
    writeFileSync(recent, "recent");
    const day = 24 * 60 * 60;
    const now = Date.now() / 1000;
    utimesSync(old, now - 8 * day, now - 8 * day);
    utimesSync(recent, now - 2 * day, now - 2 * day);
    return { t, state, backups, script: t.script("apps/api/deploy/tavora-api-backup.sh") };
  }

  it("reads the service's folder only as tavora-api, follows no link there, and keeps 7 days", () => {
    const { t, state, backups, script } = setup();
    let linked = false;
    try {
      writeFileSync(path.join(t.root, "root-only.sqlite"), "root's");
      symlinkSync(path.join(t.root, "root-only.sqlite"), path.join(state, "reviews.sqlite"));
      linked = true;
    } catch {
      // Windows without the right to make links: the link case is checked on CI (Linux).
    }
    const result = t.run(script);
    expect(result.status, result.out).toBe(0);
    expect(t.read("runuser").trim().split("\n")).toEqual(["-u tavora-api -- env -i", "-u tavora-api -- env -i"]);
    const sqlite = t.read("sqlite3").trim().split("\n");
    expect(sqlite.every((line) => line.startsWith("inside "))).toBe(true);
    expect(sqlite.map((line) => path.basename(line.split(" ")[1]!)).sort()).toEqual(["accounts.sqlite", "catalog.sqlite", "icons.sqlite"]);
    if (linked) expect(t.read("sqlite3")).not.toContain("reviews");

    const kept = readdirSync(backups).sort();
    expect(kept).not.toContain("tavora-api-20260101T031500Z.tar.gz");
    expect(kept).toContain("tavora-api-20260102T031500Z.tar.gz");
    expect(kept.filter((name) => name.endsWith(".part"))).toEqual([]);
    const made = kept.find((name) => name !== "tavora-api-20260102T031500Z.tar.gz")!;
    const listing = spawnSync("tar", ["-tzf", bashPath(path.join(backups, made))], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
    for (const entry of ["./accounts.sqlite", "./icons.sqlite", "./catalog/catalog.sqlite", "./catalog/zips/abc.zip", "./catalog/lists/revocations.json"]) {
      expect(listing).toContain(entry);
    }
    expect(listing.some((entry) => entry.includes("reviews"))).toBe(false);
    expect(readFileSync(path.join(state, "last-backup.txt"), "utf8")).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/);
    // The service's copies were made in a folder of its own, gone afterwards.
    expect(readdirSync(path.join(t.root, "tmp"))).toEqual([]);
    if (!windows) {
      expect(statSync(backups).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(backups, made)).mode & 0o777).toBe(0o600);
    }
  });

  it("keeps nothing when a copy fails", () => {
    const { t, backups, script } = setup();
    writeFileSync(path.join(t.log, "fail-sqlite"), "");
    const result = t.run(script);
    expect(result.status).not.toBe(0);
    expect(readdirSync(backups).sort()).toEqual(["tavora-api-20260101T031500Z.tar.gz", "tavora-api-20260102T031500Z.tar.gz"]);
  });
});

describe("tavora-api-catalog", () => {
  it("runs catalog.mjs as tavora-api with none of root's environment", () => {
    const t = tree();
    fakeRunuser(t);
    fake(t, "setsid", `[[ "$1" == --wait ]] && shift; exec "$@"`);
    fake(t, "node", `env | sort > "$LOG/env"; echo "$*" > "$LOG/args"`);
    const result = t.run(t.script("apps/api/deploy/tavora-api-catalog.sh"), ["list"], { env: { SSH_AUTH_SOCK: "/tmp/agent.sock", MAINTAINER_TOKEN: "secret" } });
    expect(result.status, result.out).toBe(0);
    expect(t.read("runuser")).toBe("-u tavora-api -- env -i\n");
    const env = t.read("env");
    expect(env).not.toContain("SSH_AUTH_SOCK");
    expect(env).not.toContain("secret");
    const names = env.split("\n").filter(Boolean).map((line) => line.split("=")[0]);
    for (const name of ["HOME", "LANG", "PATH", "TAVORA_STATE_DIR"]) expect(names).toContain(name);
    // bash itself adds PWD, SHLVL and _ (Git Bash on Windows a few more of its own).
    if (!windows) expect(names.filter((name) => !["PWD", "SHLVL", "_"].includes(name!))).toEqual(["HOME", "LANG", "PATH", "TAVORA_STATE_DIR"]);
    expect(t.read("args")).toContain("catalog.mjs list");
  });
});

describe("tavora-api-set-steam-key", () => {
  it("hands the key to curl on stdin, never as an argument", () => {
    const t = tree();
    mkdirSync(path.join(t.root, "srv/tavora-api/shared"), { recursive: true });
    fake(t, "curl", `printf '%s\\n' "$@" > "$LOG/curl-args"; cat > "$LOG/curl-stdin"; printf 200`);
    for (const name of ["chown", "systemctl", "journalctl", "sleep"]) fake(t, name, "exit 0");
    const key = "0123456789abcdef0123456789ABCDEF";
    const result = t.run(t.script("apps/api/deploy/tavora-api-set-steam-key.sh"), [], { input: `${key}\n` });
    expect(result.status, result.out).toBe(0);
    expect(t.read("curl-args")).not.toContain(key);
    expect(t.read("curl-args").split("\n")).toContain("-K");
    expect(t.read("curl-stdin")).toBe(`header = "x-webapi-key: ${key}"\n`);
    expect(readFileSync(path.join(t.root, "srv/tavora-api/shared/production.env"), "utf8")).toContain(`STEAM_WEB_API_KEY=${key}`);
    expect(result.out).not.toContain(key);
  });
});

describe("the DNS scripts' dns.env", () => {
  const SCRIPTS = ["apps/api/deploy/tavora-api-dns-add.sh", "apps/api/deploy/tavora-api-dns-probe.sh", "apps/desktop/deploy/tavora-updates-setup.sh"];

  function setup(envFile: string) {
    const t = tree();
    mkdirSync(path.join(t.root, "etc/caddy"), { recursive: true });
    writeFileSync(path.join(t.root, "etc/caddy/dns.env"), envFile);
    // curl: logs its arguments and the config files it was given; answers "200" (an empty zone list for the JSON readers).
    fake(t, "curl", `printf '%s\\n' "$@" >> "$LOG/curl-args"
while [[ $# -gt 0 ]]; do [[ "$1" == -K ]] && cat "$2" >> "$LOG/curl-config"; shift; done
printf 200`);
    fake(t, "python3", "cat > /dev/null; exit 0");
    fake(t, "getent", "exit 0");
    // stat -c '%u %a': the owner and mode the test sets (no test runs as root).
    fake(t, "stat", `echo "\${FAKE_STAT:-0 644}"`);
    return t;
  }
  const marker = (t: Tree) => path.join(t.root, "ran");

  it("is read as data from a root-only file, and its token never goes to curl as an argument", () => {
    for (const source of SCRIPTS.slice(0, 2)) {
      const t = setup("");
      writeFileSync(path.join(t.root, "etc/caddy/dns.env"), `# Caddy's DNS token\ntouch ${bashPath(marker(t))}\nexport HETZNER_API_TOKEN='tok-123_abc'\r\n`);
      const result = t.run(t.script(source));
      expect(existsSync(marker(t)), source).toBe(false);
      expect(t.read("curl-config"), `${source}: ${result.out}`).toContain('header = "Authorization: Bearer tok-123_abc"');
      expect(t.read("curl-args"), source).not.toContain("tok-123_abc");
      expect(result.out, source).not.toContain("tok-123_abc");
    }
  });

  it("refuses a file someone else could have written, a link, or a token that is code", () => {
    const cases: [string, Record<string, string>][] = [
      ["HETZNER_API_TOKEN=tok", { FAKE_STAT: "1000 600" }],
      ["HETZNER_API_TOKEN=tok", { FAKE_STAT: "0 664" }],
      ["HETZNER_API_TOKEN=tok", { FAKE_STAT: "0 646" }],
      ["HETZNER_API_TOKEN=$(touch RAN)", {}],
      ["OTHER=1", {}],
    ];
    for (const source of SCRIPTS.slice(0, 2)) {
      for (const [content, env] of cases) {
        const t = setup("");
        writeFileSync(path.join(t.root, "etc/caddy/dns.env"), content.replace("RAN", bashPath(marker(t))));
        const result = t.run(t.script(source), [], { env });
        const what = `${source} ${content} ${JSON.stringify(env)}`;
        expect(result.status, what).not.toBe(0);
        expect(t.read("curl-args"), what).toBe("");
        expect(existsSync(marker(t)), what).toBe(false);
      }
    }
  });

  it("is the same reader in every script that needs the token", () => {
    const reader = (source: string) => {
      const text = readFileSync(path.join(repo, source), "utf8").replace(/\r\n/g, "\n");
      return text.slice(text.indexOf("# Reads HETZNER_API_TOKEN"), text.indexOf("token=\"$(dns_token)\""));
    };
    const first = reader(SCRIPTS[0]!);
    expect(first).toContain("dns_token()");
    for (const source of SCRIPTS) {
      expect(reader(source), source).toBe(first);
      expect(readFileSync(path.join(repo, source), "utf8"), source).not.toMatch(/\.\s+\/etc\/caddy\/dns\.env|source\s+\/etc\/caddy/);
    }
  });
});

describe("the clamd filter", () => {
  const servers: net.Server[] = [];
  afterAll(() => {
    for (const server of servers) server.close();
  });
  let count = 0;
  const socketPath = () => (windows ? `\\\\.\\pipe\\tavora-clamd-test-${process.pid}-${++count}` : path.join(mkdtempSync("/tmp/tcf-"), "s"));

  /** A fake clamd: keeps what each connection sent, answers PING and a finished INSTREAM. */
  async function fakeClamd() {
    const received: Buffer[] = [];
    const listen = socketPath();
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      const index = received.push(Buffer.alloc(0)) - 1;
      socket.on("data", (data) => {
        received[index] = Buffer.concat([received[index]!, data]);
        const got = received[index]!;
        if (got.toString("latin1") === "nPING\n") socket.end("PONG\n");
        if (got.toString("latin1").startsWith("zINSTREAM\0") && got.subarray(-4).equals(Buffer.alloc(4))) socket.end("stream: OK\0");
      });
    });
    await new Promise<void>((resolve) => server.listen(listen, resolve));
    servers.push(server);
    return { listen, received };
  }

  async function exchange(filter: string, bytes: Buffer): Promise<{ reply: string; closed: boolean }> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ path: filter });
      let reply = "";
      socket.on("data", (data) => (reply += data.toString("latin1")));
      socket.on("close", () => resolve({ reply, closed: true }));
      socket.on("error", () => {});
      socket.write(bytes);
      setTimeout(() => {
        socket.destroy();
        resolve({ reply, closed: false });
      }, 2000);
    });
  }

  const chunk = (data: string) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(data, "latin1")]);
  };

  it("passes a scan stream and PING to clamd, and nothing after the stream ends", async () => {
    const clamd = await fakeClamd();
    const filter = socketPath();
    servers.push(await startFilter({ listen: filter, upstream: clamd.listen }));
    const stream = Buffer.concat([Buffer.from("zINSTREAM\0", "latin1"), chunk("hello "), chunk("world"), Buffer.alloc(4)]);
    const scan = await exchange(filter, Buffer.concat([stream, Buffer.from("zSHUTDOWN\0", "latin1")]));
    expect(scan.reply).toBe("stream: OK\0");
    expect(clamd.received[0]).toEqual(stream);
    const ping = await exchange(filter, Buffer.from("nPING\n", "latin1"));
    expect(ping.reply).toBe("PONG\n");
    expect(clamd.received).toHaveLength(2);
  });

  it("closes at once on any other command, without reaching clamd", async () => {
    const clamd = await fakeClamd();
    const filter = socketPath();
    servers.push(await startFilter({ listen: filter, upstream: clamd.listen }));
    for (const command of ["zSCAN /etc/shadow\0", "nSHUTDOWN\n", "zRELOAD\0", "zIDSESSION\0", "nCONTSCAN /\n", "SCAN /etc\n", "z" + "A".repeat(40)]) {
      const result = await exchange(filter, Buffer.from(command, "latin1"));
      expect(result, JSON.stringify(command)).toEqual({ reply: "", closed: true });
    }
    expect(clamd.received).toHaveLength(0);
  });
});
