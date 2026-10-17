#!/usr/bin/env node
// npm create @tavora/module [folder] -- [--template vanilla|vue|react] [--id publisher.name] [--name "Name"] [--yes]
// pnpm create @tavora/module [folder] [--template ...]
// Makes a new Tavora module project. Asks for what was not given, unless --yes (or no terminal):
// where (this empty folder or a new one in it) and the template are picked with the arrow keys.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { cancel, intro, isCancel, note, outro, select, text } from "@clack/prompts";
import { createModule, CreateError, defaultsFor, idProblem, nameProblem, TEMPLATES, type Template } from "./create.ts";

const USAGE = "usage: npm create @tavora/module [folder] -- [--template vanilla|vue|react] [--id publisher.module-name] [--name \"Module name\"] [--yes]";

const TEMPLATE_LABELS: Record<Template, string> = { vanilla: "Vanilla TypeScript", vue: "Vue", react: "React" };

/** The package manager that ran the starter, so the printed commands fit. */
function packageManager(): "npm" | "pnpm" | "yarn" {
  const agent = process.env.npm_config_user_agent ?? "";
  return agent.startsWith("pnpm") ? "pnpm" : agent.startsWith("yarn") ? "yarn" : "npm";
}

/** Thrown when the developer pressed Ctrl+C or Esc in a question. */
class Cancelled extends Error {}

function answer<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) throw new Cancelled();
  return value as Exclude<T, symbol>;
}

async function isEmptyFolder(dir: string): Promise<boolean> {
  return ((await readdir(dir).catch(() => null))?.length ?? -1) === 0;
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
  if (values.template !== undefined && !TEMPLATES.includes(values.template as Template)) {
    console.error(`create-module: the template is one of ${TEMPLATES.join(", ")}`);
    return 2;
  }

  const interactive = !values.yes && process.stdin.isTTY === true;
  const here = process.cwd();
  const emptyHere = await isEmptyFolder(here);

  try {
    if (interactive) intro("A new Tavora module");

    // Where: the empty folder the developer is in, or a new folder in it.
    let folder = positionals[0];
    if (folder === undefined && interactive) {
      const where = emptyHere
        ? answer(
            await select({
              message: "Where should the project go?",
              options: [
                { value: ".", label: `This folder (${path.basename(here)})`, hint: "it is empty" },
                { value: "new", label: "A new folder in it" },
              ],
            }),
          )
        : "new";
      folder =
        where === "."
          ? "."
          : answer(
              await text({
                message: "Folder name for the project",
                placeholder: "my-tavora-module",
                defaultValue: "my-tavora-module",
                validate: (value) => (value && /[\\/:*?"<>|]/.test(value) ? "a folder name, without \\ / : * ? \" < > |" : undefined),
              }),
            );
    }
    folder ??= emptyHere ? "." : "my-tavora-module";

    const defaults = defaultsFor(folder);
    const name =
      values.name ??
      (interactive
        ? answer(await text({ message: "Module name", placeholder: defaults.name, defaultValue: defaults.name, validate: (value) => (value ? (nameProblem(value) ?? undefined) : undefined) }))
        : defaults.name);
    const id =
      values.id ??
      (interactive
        ? answer(
            await text({
              message: "Module id (publisher.module-name)",
              placeholder: defaults.id,
              defaultValue: defaults.id,
              validate: (value) => (value ? (idProblem(value) ?? undefined) : undefined),
            }),
          )
        : defaults.id);
    const template = (values.template ??
      (interactive
        ? answer(await select({ message: "Template", options: TEMPLATES.map((value) => ({ value, label: TEMPLATE_LABELS[value] })), initialValue: "vanilla" as Template }))
        : "vanilla")) as Template;

    const manager = packageManager();
    await createModule({ dir: folder, id, name, template, packageManager: manager });

    const run = manager === "npm" ? "npm run" : manager;
    const project = path.resolve(folder);
    const steps = [
      ...(folder === "." ? [] : [`cd ${folder}`]),
      `${manager} install`,
      `${run} dev        # builds, then rebuilds on every change: leave it running`,
      "",
      "Then in Tavora: Settings > Development > Add a development folder…",
      `and pick ${project}`,
      ...(folder === "." ? [] : [`(or ${here}, to load every module project you keep in it)`]),
    ];
    if (interactive) {
      note(steps.join("\n"), "Next");
      outro(`Made ${name} (${id}). The README says how to share it and show your name on it.`);
    } else {
      console.log(`\nMade ${name} (${id}) in ${project}.\n\nNext:\n${steps.map((line) => (line ? `  ${line}` : "")).join("\n")}\n`);
      console.log("The README says how to share the module and show your name on it.");
    }
    return 0;
  } catch (error) {
    if (error instanceof Cancelled) {
      cancel("Nothing was made.");
      return 1;
    }
    if (error instanceof CreateError) {
      console.error(`create-module: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
