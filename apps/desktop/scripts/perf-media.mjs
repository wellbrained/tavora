// Measures what the Media connector's helper (packages/media-helper, tavora-media.exe) costs while it watches.
// Run it on Windows after `pnpm --filter @tavora/media-helper build`, with music playing, skipping songs now and then:
//
//   pnpm perf:media                 60 seconds
//   pnpm perf:media --seconds 300
//
// It prints how much of the whole PC the helper used (its CPU time over wall time over logical processors), its
// memory at the end, and how many lines and covers it sent. The budget is about 0 % of the PC (it only wakes on a
// change) and a few MB. Tavora's own side (reading lines, shrinking a cover once per song) runs in Tavora's process.
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const exe = path.join(repo, "packages", "media-helper", "bin", "tavora-media.exe");
const at = process.argv.indexOf("--seconds");
const seconds = at >= 0 ? Number(process.argv[at + 1]) : 60;

if (process.platform !== "win32") {
  console.error("The media helper runs on Windows only.");
  process.exit(1);
}
if (!existsSync(exe)) {
  console.error(`Build the helper first: pnpm --filter @tavora/media-helper build (${exe} is missing)`);
  process.exit(1);
}

/** The process's CPU seconds and working set, as Windows counts them. */
function usage(pid) {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", `$p = Get-Process -Id ${pid}; "$($p.TotalProcessorTime.TotalSeconds) $($p.WorkingSet64)"`], { encoding: "utf8" }).trim();
  const [cpu, memory] = out.split(/\s+/).map(Number);
  return { cpu, memory };
}

const child = spawn(exe, [], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
let lines = 0;
let covers = 0;
let sessions = 0;
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    lines++;
    if (line.includes('"type":"cover"')) covers++;
    else if (line.includes('"sessions"')) sessions++;
  }
});

// Let it start and send what plays now before counting.
await new Promise((resolve) => setTimeout(resolve, 2000));
const start = usage(child.pid);
const startedAt = Date.now();
const startLines = lines;
console.log(`Watching for ${seconds} s…`);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const end = usage(child.pid);
const wall = (Date.now() - startedAt) / 1000;
const share = ((end.cpu - start.cpu) / wall / os.cpus().length) * 100;
child.stdin.end();

console.log(`CPU: ${share.toFixed(3)} % of the PC (${((end.cpu - start.cpu) * 1000).toFixed(0)} ms CPU in ${wall.toFixed(0)} s)`);
console.log(`Memory: ${(end.memory / 1024 / 1024).toFixed(1)} MB`);
console.log(`Lines: ${lines - startLines} while counting (${sessions} session updates, ${covers} covers in all)`);
