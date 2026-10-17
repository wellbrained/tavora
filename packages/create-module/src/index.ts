#!/usr/bin/env node
// npm create @tavora/module [folder] -- [--template vanilla|vue|react] [--id publisher.name] [--name "Name"] [--yes]
// pnpm create @tavora/module [folder] [--template ...]
// Makes a new Tavora module project. Asks for what was not given, unless --yes (or no terminal).
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createModule, CreateError, defaultsFor, idProblem, nameProblem, TEMPLATES, type Template } from "./create.ts";

const USAGE = "usage: npm create @tavora/module [folder] -- [--template vanilla|vue|react] [--id publisher.module-name] [--name \"Module name\"] [--yes]";

/** The package manager that ran the starter, so the printed commands fit. */
function packageManager(): "npm" | "pnpm" | "yarn" {
  const agent = process.env.npm_config_user_agent ?? "";
  return agent.startsWith("pnpm") ? "pnpm" : agent.startsWith("yarn") ? "yarn" : "npm";
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: { template: { type: "string", short: "t" }, id: { type: "string" }, name: { type: "string" }, yes: { type: "boolean", short: "y" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length > 1) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const interactive = !values.yes && process.stdin.isTTY === true;
  const prompt = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  /** Asks until the answer is fine; Enter takes the suggestion. */
  const ask = async (question: string, suggestion: string, problem: (value: string) => string | null = () => null): Promise<string> => {
    if (!prompt) return suggestion;
    for (;;) {
      const answer = (await prompt.question(`${question} (${suggestion}): `)).trim() || suggestion;
      const wrong = problem(answer);
      if (!wrong) return answer;
      console.log(`  ${wrong}`);
    }
  };

  try {
    const folder = positionals[0] ?? (await ask("Project folder", "my-tavora-module"));
    const defaults = defaultsFor(folder);
    const name = values.name ?? (await ask("Module name", defaults.name, nameProblem));
    const id = values.id ?? (await ask("Module id, publisher.module-name", defaults.id, idProblem));
    const template = (values.template ?? (await ask(`Template, ${TEMPLATES.join(" / ")}`, "vanilla", (value) => (TEMPLATES.includes(value as Template) ? null : `one of ${TEMPLATES.join(", ")}`)))) as Template;
    const manager = packageManager();
    await createModule({ dir: folder, id, name, template, packageManager: manager });

    const run = manager === "npm" ? "npm run" : manager;
    console.log(`\nMade ${name} (${id}) in ${path.resolve(folder)}.\n`);
    console.log("Next:");
    console.log(`  cd ${folder}`);
    console.log(`  ${manager} install`);
    console.log(`  ${run} dev`);
    console.log("Then in Tavora: Settings > Modules > Add a development folder, and choose that folder.");
    console.log("The README says how to share the module and show your name on it.");
    return 0;
  } catch (error) {
    if (error instanceof CreateError) {
      console.error(`create-module: ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    prompt?.close();
  }
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
