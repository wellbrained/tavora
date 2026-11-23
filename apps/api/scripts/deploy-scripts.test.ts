import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript run by node on the server, no types
import { startFilter, streamLimit } from "../deploy/tavora-clamd-filter.mjs";

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
        .replace(/(?<![\w/])\/(var\/lib\/tavora-api|srv\/tavora-api|etc\/caddy|etc\/clamav|etc\/systemd|run\/clamav|run\/tavora-clamd|usr\/local\/lib\/tavora)(?=[/\s"']|$)/gm, `${r}/$1`);
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

// The server has GNU tar and coreutils: macOS's bsdtar pads its gzip (which gzip -t then calls trailing garbage) and its
// stat takes other flags, so the backup is checked on Linux (CI) and in Git Bash on Windows, never on a Mac.
describe.skipIf(process.platform === "darwin")("the daily backup", { timeout: 30_000 }, () => {
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
    mkdirSync(path.join(state, "catalog/pictures"), { recursive: true });
    mkdirSync(path.join(t.root, "tmp"));
    writeFileSync(path.join(state, "accounts.sqlite"), "accounts");
    writeFileSync(path.join(state, "icons.sqlite"), "icons");
    writeFileSync(path.join(state, "activity.sqlite"), "activity");
    writeFileSync(path.join(state, "module-requests.salt"), "a secret");
    writeFileSync(path.join(state, "catalog/catalog.sqlite"), "catalog");
    writeFileSync(path.join(state, "catalog/zips/abc.zip"), "zip");
    writeFileSync(path.join(state, "catalog/lists/revocations.json"), "{}");
    writeFileSync(path.join(state, "catalog/pictures/shot.webp"), "picture");
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
    // The packing, the gzip check and the time stamp: all three as the service's user.
    expect(t.read("runuser").trim().split("\n")).toEqual(Array(3).fill("-u tavora-api -- env -i"));
    const sqlite = t.read("sqlite3").trim().split("\n");
    expect(sqlite.every((line) => line.startsWith("inside "))).toBe(true);
    expect(sqlite.map((line) => path.basename(line.split(" ")[1]!)).sort()).toEqual(["accounts.sqlite", "activity.sqlite", "catalog.sqlite", "icons.sqlite"]);
    if (linked) expect(t.read("sqlite3")).not.toContain("reviews");

    const kept = readdirSync(backups).sort();
    expect(kept).not.toContain("tavora-api-20260101T031500Z.tar.gz");
    expect(kept).toContain("tavora-api-20260102T031500Z.tar.gz");
    expect(kept.filter((name) => name.endsWith(".part"))).toEqual([]);
    const made = kept.find((name) => name !== "tavora-api-20260102T031500Z.tar.gz")!;
    const listing = spawnSync("bash", ["-c", 'tar -tzf "$1"', "_", bashPath(path.join(backups, made))], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
    for (const entry of ["./accounts.sqlite", "./icons.sqlite", "./catalog/catalog.sqlite", "./catalog/zips/abc.zip", "./catalog/lists/revocations.json", "./catalog/pictures/shot.webp", "./activity.sqlite"]) {
      expect(listing).toContain(entry);
    }
    expect(listing.some((entry) => entry.includes("reviews"))).toBe(false);
    expect(listing.some((entry) => entry.includes("salt"))).toBe(false);
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

  it("keeps the day's backup when tar only says a file changed while it was read", () => {
    const { t, backups, script } = setup();
    fake(t, "tar", `/usr/bin/tar "$@" || exit $?; exit 1`);
    const result = t.run(script);
    expect(result.status, result.out).toBe(0);
    expect(readdirSync(backups).filter((name) => !name.startsWith("tavora-api-2026010"))).toHaveLength(1);
  });

  it("keeps nothing bigger than half the free space", () => {
    const { t, state, backups, script } = setup();
    writeFileSync(path.join(state, "catalog/zips/big.zip"), randomBytes(8192));
    // 1 KB free: at most 512 bytes may be written.
    fake(t, "df", `printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfake 100 99 1 99%% /\\n'`);
    const result = t.run(script);
    expect(result.status).not.toBe(0);
    expect(result.out).toContain("half the free space");
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

  it("is read as data from a root-only file, and its token never goes to curl as an argument", { timeout: 30_000 }, () => {
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

  // Twenty bash runs: slow on a Mac's bash, so more time than vitest's 5 s.
  it("refuses a file someone else could have written, a link, or a token that is code", { timeout: 30_000 }, () => {
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

describe("tavora-api-clamav", () => {
  /**
   * The setup with every system command faked. systemctl logs its calls; `cat clamav-daemon.socket` succeeds when the test
   * says there is a socket unit, `show -P Listen` answers what it says, and `is-active` is true for the units it marks.
   * stat reports the socket as FAKE_STAT until clamd's socket was started again, then as FAKE_STAT_AFTER (both 660 clamav
   * unless set). `@SOCK@` stands for clamd's socket path inside the tree.
   */
  function setup({
    socketUnit = true,
    listen = "@SOCK@ (Stream)",
    active = ["clamav-daemon.service", "clamav-daemon.socket"],
    conf = "LocalSocket @SOCK@\nLocalSocketMode 666" as string | null,
    dropin = null as string | null,
  } = {}) {
    const t = tree();
    const sock = `${bashPath(t.root)}/run/clamav/clamd.ctl`;
    const place = (text: string) => text.replaceAll("@SOCK@", sock);
    for (const folder of ["srv/tavora-api/shared", "usr/local/lib/tavora", "etc/systemd/system/clamav-daemon.socket.d", "etc/clamav"]) mkdirSync(path.join(t.root, folder), { recursive: true });
    writeFileSync(path.join(t.root, "usr/local/lib/tavora/tavora-clamd-filter.mjs"), "");
    writeFileSync(path.join(t.root, "etc/systemd/system/tavora-clamd-filter.service"), "");
    const confFile = path.join(t.root, "etc/clamav/clamd.conf");
    const dropinFile = path.join(t.root, "etc/systemd/system/clamav-daemon.socket.d/tavora.conf");
    if (conf !== null) writeFileSync(confFile, place(conf));
    if (dropin !== null) writeFileSync(dropinFile, dropin);
    if (socketUnit) writeFileSync(path.join(t.log, "socket-unit"), "");
    writeFileSync(path.join(t.log, "listen"), `${place(listen)}\n`);
    for (const unit of active) writeFileSync(path.join(t.log, `active-${unit}`), "");
    fake(t, "systemctl", `echo "$*" >> "$LOG/systemctl"
case "$1" in
  cat) [[ "$2" == clamav-daemon.socket && -e "$LOG/socket-unit" ]]; exit ;;
  show) [[ "$*" == *Listen* ]] && cat "$LOG/listen"; [[ ! -e "$LOG/show-fails" ]]; exit ;;
  is-active) [[ -e "$LOG/active-\${!#}" ]]; exit ;;
esac
exit 0`);
    for (const name of ["apt-get", "freshclam", "gpasswd", "sleep", "seq"]) fake(t, name, "exit 0");
    fake(t, "debconf-set-selections", `cat >> "$LOG/debconf"`);
    fake(t, "id", `echo tavora-api`);
    fake(t, "timeout", `shift; exec "$@"`);
    fake(t, "socat", `cat > /dev/null; echo PONG`);
    fake(t, "stat", `if grep -qE '^(start clamav-daemon|restart clamav-daemon)' "$LOG/systemctl" 2>/dev/null; then echo "\${FAKE_STAT_AFTER:-660 clamav}"; else echo "\${FAKE_STAT:-660 clamav}"; fi`);
    fake(t, "tavora-api-set-setting", `echo "$*" >> "$LOG/set-setting"`);
    return {
      t,
      script: t.script("apps/api/deploy/tavora-api-clamav.sh"),
      conf: () => readFileSync(confFile, "utf8").replaceAll(sock, "@SOCK@"),
      old: () => readFileSync(`${confFile}.tavora-old`, "utf8").replaceAll(sock, "@SOCK@"),
      dropin: dropinFile,
    };
  }
  const calls = (t: Tree) => t.read("systemctl").trim().split("\n");
  const restarts = (t: Tree) => calls(t).filter((call) => /^(restart|stop|start) clamav-daemon/.test(call));
  const WANTED_DROPIN = "# Written by tavora-api-clamav (Tavora): clamd's socket for the clamav group only.\n[Socket]\nSocketGroup=clamav\nSocketMode=0660\n";

  it("gives clamd's socket unit a 660 clamav drop-in, edits clamd.conf too, and makes the socket again once", { timeout: 30_000 }, () => {
    const { t, script, conf, old, dropin } = setup();
    const result = t.run(script);
    expect(result.status, result.out).toBe(0);
    expect(readFileSync(dropin, "utf8")).toBe(WANTED_DROPIN);
    // The file had no line break at its end: the new line is still a line of its own.
    expect(conf()).toBe("LocalSocket @SOCK@\nLocalSocketMode 660\nLocalSocketGroup clamav\n");
    expect(old()).toBe("LocalSocket @SOCK@\nLocalSocketMode 666");
    expect(t.read("debconf")).toContain("clamav-daemon/LocalSocketMode string 660");
    const log = calls(t);
    const order = ["daemon-reload", "stop clamav-daemon.service clamav-daemon.socket", "start clamav-daemon.socket clamav-daemon.service"].map((call) => log.indexOf(call));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!)), log.join("\n")).toBe(true);
    expect(restarts(t)).toHaveLength(2);
    expect(t.read("set-setting")).toBe("clamav\n");

    // Again: all in place, so clamd isn't stopped (no second load of its signatures), and the original stays as it was.
    writeFileSync(path.join(t.log, "systemctl"), "");
    const again = t.run(script);
    expect(again.status, again.out).toBe(0);
    expect(calls(t).filter((call) => /^(restart|stop|start|daemon-reload)( |$)/.test(call) && call.includes("clamav-daemon"))).toEqual([]);
    expect(old()).toBe("LocalSocket @SOCK@\nLocalSocketMode 666");
  });

  it("remakes a 666 socket on a rerun after a cut-off run, also with only the socket unit listening", { timeout: 30_000 }, () => {
    // The settings are all in place (an earlier run got that far), but the socket is still the old one.
    const { t, script } = setup({ active: ["clamav-daemon.socket"], conf: "LocalSocket @SOCK@\nLocalSocketMode 660\nLocalSocketGroup clamav\n", dropin: WANTED_DROPIN });
    const result = t.run(script, [], { env: { FAKE_STAT: "666 clamav" } });
    expect(result.status, result.out).toBe(0);
    expect(restarts(t)).toEqual(["stop clamav-daemon.service clamav-daemon.socket", "start clamav-daemon.socket clamav-daemon.service"]);
    expect(calls(t)).not.toContain("daemon-reload");
    expect(t.read("set-setting")).toBe("clamav\n");
  });

  it("starts a clamd that isn't running only once, with the new settings", { timeout: 30_000 }, () => {
    const { t, script } = setup({ active: [] });
    const result = t.run(script);
    expect(result.status, result.out).toBe(0);
    expect(restarts(t)).toEqual([]);
    expect(calls(t)).toContain("enable --now clamav-daemon.socket clamav-daemon.service");
  });

  it("without a socket unit, sets clamd.conf only and restarts clamd", { timeout: 30_000 }, () => {
    const { t, script, dropin } = setup({ socketUnit: false, active: ["clamav-daemon.service"] });
    rmSync(dropin, { force: true });
    const result = t.run(script);
    expect(result.status, result.out).toBe(0);
    expect(existsSync(dropin)).toBe(false);
    expect(calls(t)).toContain("restart clamav-daemon");
  });

  it("refuses clamd on a TCP port, a socket elsewhere, an unreadable socket unit, and a missing clamd.conf", { timeout: 30_000 }, () => {
    const cases: [Parameters<typeof setup>[0], RegExp][] = [
      [{ listen: "127.0.0.1:3310 (Stream)" }, /listens on 127/],
      [{ listen: "@SOCK@ (Stream)\n[::]:3310 (Stream)" }, /listens on \[::\]/],
      [{ listen: "@clamd (Stream)" }, /listens on @clamd/],
      [{ conf: "TCPSocket 3310\n" }, /TCP port/],
      [{ conf: null }, /No .*clamd\.conf/],
      [{ listen: "/srv/elsewhere/clamd.ctl (Stream)" }, /expect/],
      [{ socketUnit: false, conf: "LocalSocket /srv/elsewhere/clamd.ctl\n" }, /expect/],
    ];
    for (const [options, message] of cases) {
      const { t, script } = setup(options);
      const result = t.run(script);
      expect(result.status, JSON.stringify(options)).not.toBe(0);
      expect(t.read("set-setting"), JSON.stringify(options)).toBe("");
      expect(result.out, JSON.stringify(options)).toMatch(message);
    }
    const { t, script } = setup();
    writeFileSync(path.join(t.log, "show-fails"), "");
    const result = t.run(script);
    expect(result.status).not.toBe(0);
    expect(result.out).toContain("Can't read where clamav-daemon.socket listens");
    expect(restarts(t)).toEqual([]);
  });

  it("stops before switching the service when the socket still isn't 660 clamav", { timeout: 30_000 }, () => {
    const { t, script } = setup();
    const result = t.run(script, [], { env: { FAKE_STAT: "666 root", FAKE_STAT_AFTER: "666 root" } });
    expect(result.status).not.toBe(0);
    expect(result.out).toContain("not 660 clamav");
    expect(t.read("set-setting")).toBe("");
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

  it("answers the PING tavora-api-clamav sends (setup and status)", async () => {
    const clamd = await fakeClamd();
    const filter = socketPath();
    servers.push(await startFilter({ listen: filter, upstream: clamd.listen }));
    // The script's own answers(), with socat and timeout faked: what it would send is kept, and what the filter answers to
    // exactly those bytes is fed back to it.
    const t = tree();
    fake(t, "timeout", `shift; exec "$@"`);
    fake(t, "socat", `cat > "$LOG/sent"; cat "$LOG/reply" 2>/dev/null; true`);
    const text = readFileSync(path.join(deploy, "tavora-api-clamav.sh"), "utf8").replace(/\r\n/g, "\n");
    const line = /^answers\(\) \{.*\}$/m.exec(text)?.[0];
    expect(line).toBeDefined();
    const probe = path.join(t.root, "probe.sh");
    writeFileSync(probe, `${line}\nanswers /run/tavora-clamd/clamd.sock\n`);
    expect(t.run(probe).status).not.toBe(0);
    const reply = await exchange(filter, Buffer.from(t.read("sent"), "latin1"));
    expect(reply.reply).toBe("PONG\n");
    writeFileSync(path.join(t.log, "reply"), reply.reply);
    expect(t.run(probe).status).toBe(0);
  });

  it("passes nothing more once clamd has answered", async () => {
    // A clamd that answers after the first chunk (as with "size limit exceeded") and keeps the connection open.
    const received: Buffer[] = [];
    const listen = socketPath();
    const clamd = net.createServer({ allowHalfOpen: true }, (socket) => {
      const index = received.push(Buffer.alloc(0)) - 1;
      socket.on("data", (data) => {
        received[index] = Buffer.concat([received[index]!, data]);
        if (received[index]!.length >= 10 + 4 + 5) socket.write("INSTREAM size limit exceeded. ERROR\0");
      });
    });
    await new Promise<void>((resolve) => clamd.listen(listen, resolve));
    servers.push(clamd);
    const filter = socketPath();
    servers.push(await startFilter({ listen: filter, upstream: listen }));
    const first = Buffer.concat([Buffer.from("zINSTREAM\0", "latin1"), chunk("first")]);
    const reply = await new Promise<string>((resolve) => {
      const socket = net.createConnection({ path: filter });
      socket.on("error", () => {});
      socket.once("data", (data) => {
        socket.write(Buffer.concat([chunk("second"), Buffer.alloc(4)]));
        setTimeout(() => {
          socket.destroy();
          resolve(data.toString("latin1"));
        }, 300);
      });
      socket.write(first);
    });
    expect(reply).toContain("size limit exceeded");
    expect(received[0]).toEqual(first);
  });

  it("ends the client's connection when clamd goes away mid-stream, even while the client waits for it to drain", async () => {
    const listen = socketPath();
    // A clamd that reads nothing (so the filter's writes back up and the client is paused), then hangs up.
    const clamd = net.createServer((socket) => {
      socket.pause();
      setTimeout(() => socket.destroy(), 300);
    });
    await new Promise<void>((resolve) => clamd.listen(listen, resolve));
    servers.push(clamd);
    const filter = socketPath();
    servers.push(await startFilter({ listen: filter, upstream: listen }));
    const big = Buffer.alloc(4 * 1024 * 1024, 0x61);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(big.length);
    const result = await exchange(filter, Buffer.concat([Buffer.from("zINSTREAM\0", "latin1"), length, big]));
    expect(result.closed).toBe(true);
  });

  it("refuses a stream longer than clamd's StreamMaxLength", async () => {
    expect(streamLimit("LocalSocket /run/clamav/clamd.ctl\nStreamMaxLength 100M\n")).toBe(100 * 1024 * 1024);
    expect(streamLimit("StreamMaxLength 512K")).toBe(512 * 1024);
    expect(streamLimit("StreamMaxLength 4096")).toBe(4096);
    expect(streamLimit("#StreamMaxLength 1M\n")).toBe(25 * 1024 * 1024);
    expect(streamLimit("")).toBe(25 * 1024 * 1024);
    // Like clamd: the last line counts.
    expect(streamLimit("StreamMaxLength 25M\nStreamMaxLength 1G\n")).toBe(1024 ** 3);
    expect(streamLimit("StreamMaxLength 1G\r\nStreamMaxLength 10M\r\n")).toBe(10 * 1024 ** 2);
    const clamd = await fakeClamd();
    const filter = socketPath();
    servers.push(await startFilter({ listen: filter, upstream: clamd.listen, maxStream: 8 }));
    const result = await exchange(filter, Buffer.concat([Buffer.from("zINSTREAM\0", "latin1"), chunk("12345"), chunk("67890"), Buffer.alloc(4)]));
    expect(result).toEqual({ reply: "", closed: true });
    expect(Buffer.concat(clamd.received).toString("latin1")).not.toContain("67890");
  });
});
