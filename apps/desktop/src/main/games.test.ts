import { readFile } from "node:fs/promises";
import path from "node:path";
import { THEME_TOKENS } from "@tavora/sdk/protocol";
import { describe, expect, it } from "vitest";
import { THEME } from "./games";

/** Reads `--name: value;` pairs from the :root block of a stylesheet. */
async function rootTokens(file: string): Promise<Record<string, string>> {
  const css = await readFile(file, "utf8");
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  return Object.fromEntries([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]));
}

const repo = path.resolve(__dirname, "../../../..");

describe("module theme", () => {
  it("has every token, matching the host UI and the official modules' defaults", async () => {
    expect(Object.keys(THEME.tokens).sort()).toEqual([...THEME_TOKENS].sort());
    for (const file of ["apps/desktop/src/renderer/styles.css", "modules/shared/src/theme.css"]) {
      const css = await rootTokens(path.join(repo, file));
      for (const name of THEME_TOKENS) expect([file, name, css[name]]).toEqual([file, name, THEME.tokens[name]]);
      expect(css.radius).toBe(`${THEME.radius}px`);
    }
  });

  it("keeps the short colour summary in step with the tokens", () => {
    expect(THEME.colors).toEqual({
      background: THEME.tokens.background,
      surface: THEME.tokens.card,
      text: THEME.tokens.foreground,
      textMuted: THEME.tokens["muted-foreground"],
      accent: THEME.tokens.primary,
    });
  });
});
