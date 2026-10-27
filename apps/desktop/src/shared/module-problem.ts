// Why a module did not load, as the host reports it. Each reason has a kind and the
// details its text names, so the window can say it in the user's language instead
// of showing the English line the log gets.
import type { MessageKey, Params } from "./i18n";

export type ModuleProblemKind =
  | "not-built"
  | "no-module"
  | "missing"
  | "unreadable"
  | "invalid"
  | "needs-newer"
  | "icon-missing"
  | "reserved-id"
  | "webassembly"
  | "duplicate-id"
  | "blocked";

/** The details a problem's text names; only the ones its kind uses are set. */
export interface ModuleProblemValues {
  /** "invalid": what the manifest got wrong, as the schema words it. */
  errors?: string;
  /** "needs-newer": the Tavora version it asks for, and the one running. */
  needs?: string;
  current?: string;
  /** "not-built" and "icon-missing": the file that is missing. */
  file?: string;
  /** "blocked": the module and why Tavora stopped it. */
  name?: string;
  version?: string;
  reason?: string;
}

type Translate = (key: MessageKey, params?: Params) => string;

const REASONS: Partial<Record<ModuleProblemKind, MessageKey>> = {
  unreadable: "moduleProblem.unreadable",
  invalid: "moduleProblem.invalid",
  "needs-newer": "moduleProblem.needsNewer",
  "icon-missing": "moduleProblem.iconMissing",
  "reserved-id": "moduleProblem.reservedId",
  webassembly: "moduleProblem.webassembly",
  "duplicate-id": "moduleProblem.duplicateId",
};

/**
 * The text for a problem in Settings. `where` says which list it sits in: the modules list
 * prefixes a reason with "can't load", the development list with "not loaded". Kinds that
 * are a whole sentence (not built, no module, missing, blocked) bring their own words; `folderName` is the project folder a not-built text names.
 */
export function problemText(translate: Translate, where: "modules" | "development", kind: ModuleProblemKind | null | undefined, values: ModuleProblemValues = {}, folderName = ""): string {
  const folder = where === "development";
  if (kind === "not-built") return translate(folder ? "settings.devFolders.notBuilt" : "settings.modules.notBuilt", { folder: folderName });
  if (kind === "no-module") return translate("settings.devFolders.noModule");
  if (kind === "missing") return translate("settings.devFolders.missing");
  if (kind === "blocked") return translate("moduleProblem.blocked", { name: values.name ?? "", version: values.version ?? "", reason: values.reason ?? "" });
  const reason = kind ? REASONS[kind] : undefined;
  if (!reason) return translate("moduleProblem.generic");
  return translate(folder ? "settings.devFolders.problem" : "settings.modules.problem", {
    message: translate(reason, { errors: values.errors ?? "", needs: values.needs ?? "", current: values.current ?? "", file: values.file ?? "" }),
  });
}
