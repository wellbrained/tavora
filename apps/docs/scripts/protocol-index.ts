// Writes the method index of reference/protocol.md from METHOD_INFO (packages/sdk/src/protocol.ts), or with --check
// says whether the page is out of date. `pnpm --filter @tavora/docs protocol` writes, `protocol:check` checks; the repository's
// tests check too, so a changed table without a regenerated page fails CI.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { METHOD_INFO, MIN_TAVORA, type CallName, type MethodInfo } from "../../../packages/sdk/src/protocol.ts";

export const PAGE = fileURLToPath(new URL("../reference/protocol.md", import.meta.url));
export const START = "<!-- protocol-index:start -->";
export const END = "<!-- protocol-index:end -->";

function gestureOf(info: MethodInfo): string {
  if (typeof info.gesture === "boolean") return info.gesture ? "always" : "";
  return info.gesture.when;
}

/** The generated block, markers included, with CRLF-free lines. */
export function renderIndex(): string {
  const rows = (Object.entries(METHOD_INFO) as [CallName, MethodInfo][]).map(([method, info]) => {
    const since = info.later ? info.since : info.since === "0.1.0" ? "always" : `${info.since}`;
    return `| \`${method}\` | ${since} | ${info.capability ? `\`${info.capability}\`` : ""} | ${gestureOf(info)} |`;
  });
  return [
    START,
    "<!-- generated from METHOD_INFO by apps/docs/scripts/protocol-index.ts; do not edit -->",
    "",
    `A Tavora older than **Since** throws \`UNKNOWN_METHOD\` for the call; \`sdk.supports(call)\` tells beforehand. **Click** says the call must come right after a click or key press in the panel, always or for the params named. \`MIN_TAVORA\` is ${MIN_TAVORA}: the newest of the calls not marked later (the ones before it work on every Tavora the SDK supports).`,
    "",
    "| Call | Since | Capability | Click |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    END,
  ].join("\n");
}

/** The page with its generated block replaced. */
export function withIndex(page: string): string {
  const text = page.replace(/\r\n/g, "\n");
  const from = text.indexOf(START);
  const to = text.indexOf(END);
  if (from < 0 || to < from) throw new Error(`${PAGE} has no protocol-index markers`);
  return text.slice(0, from) + renderIndex() + text.slice(to + END.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const page = readFileSync(PAGE, "utf8");
  const next = withIndex(page).replace(/\n/g, "\r\n");
  if (process.argv.includes("--check")) {
    if (next !== page) {
      console.error("reference/protocol.md is out of date: run `pnpm --filter @tavora/docs protocol`");
      process.exit(1);
    }
  } else {
    writeFileSync(PAGE, next);
  }
}
