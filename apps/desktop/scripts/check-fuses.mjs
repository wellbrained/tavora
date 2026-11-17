// Reads the Electron fuses of a built Tavora.exe and fails unless each is set the safe way: no running as plain
// Node (RunAsNode, NODE_OPTIONS, --inspect), cookies encrypted, the app loaded only from app.asar and that
// archive checked against the hash in the exe. electron-builder flips them from package.json's electronFuses;
// this catches a build where that silently didn't happen. Used by CI's packaged-start job.
//
//   node scripts/check-fuses.mjs <Tavora.exe>
import { pathToFileURL } from "node:url";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

/** The byte of each fuse state in the exe (@electron/fuses keeps its FuseState enum to itself). */
export const FuseState = { DISABLE: 48, ENABLE: 49, REMOVED: 114, INHERIT: 144 };

/** Each fuse the exe must have, and whether it must be on. */
export const REQUIRED_FUSES = [
  ["RunAsNode", false],
  ["EnableNodeOptionsEnvironmentVariable", false],
  ["EnableNodeCliInspectArguments", false],
  ["EnableCookieEncryption", true],
  ["OnlyLoadAppFromAsar", true],
  ["EnableEmbeddedAsarIntegrityValidation", true],
];

/** What is wrong with a fuse wire (as getCurrentFuseWire reads it), one line per fuse; empty when all is well. */
export function fuseProblems(wire) {
  const problems = [];
  for (const [name, on] of REQUIRED_FUSES) {
    const state = wire[FuseV1Options[name]];
    const want = on ? FuseState.ENABLE : FuseState.DISABLE;
    if (state !== want) problems.push(`${name} should be ${on ? "enabled" : "disabled"}, is ${describe(state)}`);
  }
  return problems;
}

function describe(state) {
  if (state === FuseState.ENABLE) return "enabled";
  if (state === FuseState.DISABLE) return "disabled";
  if (state === FuseState.REMOVED) return "removed";
  if (state === FuseState.INHERIT) return "inherited";
  return "missing";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exe = process.argv[2];
  if (!exe) {
    console.error("Usage: node scripts/check-fuses.mjs <Tavora.exe>");
    process.exit(2);
  }
  const problems = fuseProblems(await getCurrentFuseWire(exe));
  if (problems.length > 0) {
    console.error(`The fuses of ${exe} are not safe:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`The fuses of ${exe} are safe: ${REQUIRED_FUSES.map(([name, on]) => `${name} ${on ? "on" : "off"}`).join(", ")}.`);
}
