// What every component of a panel shares: the SDK, the services, and game
// names in Tavora's language.

import type { TavoraSDK, TooltipContent } from "@tavora/sdk";
import { inject, type Directive, type InjectionKey } from "vue";
import { language } from "../i18n";
import type { Entry } from "./search";
import type { Services } from "./services";
import { buildingName, itemName, recipeName } from "./names";

export interface ModuleContext {
  sdk: TavoraSDK;
  services: Services;
  /** Shows one line at the top of the panel for a few seconds. */
  notify(message: string): void;
  /** The `v-tip` directive: `const vTip = useModule().tip` in a component. */
  tip: Directive<HTMLElement, () => TooltipContent | null>;
}

export const MODULE: InjectionKey<ModuleContext> = Symbol("satisfactory");

export function useModule(): ModuleContext {
  const context = inject(MODULE);
  if (!context) throw new Error("useModule outside the module");
  return context;
}

/** Game names that follow the language Tavora shows (read inside a render or computed, so they update). */
export function useNames(context: ModuleContext = useModule()) {
  const { data } = context.services;
  return {
    item: (id: string) => itemName(data, id, language.value),
    recipe: (id: string) => recipeName(data, id, language.value),
    building: (id: string) => buildingName(data, id, language.value),
    entry: (entry: Entry) =>
      entry.kind === "item" ? itemName(data, entry.id, language.value) : entry.kind === "recipe" ? recipeName(data, entry.id, language.value) : buildingName(data, entry.id, language.value),
  };
}
