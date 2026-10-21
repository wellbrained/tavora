// Turning data and solver answers into the module's words. The translator is
// passed in, so this stays plain TypeScript.

import type { GameData, ItemId, Unlock } from "../contracts/data";
import type { SolveError } from "../contracts/plan";
import type { Params } from "@tavora/official-ui";
import type { TextKey } from "../i18n";
import { formatRate } from "./format";
import { itemName, localize, recipeName } from "./names";

export type T = (key: TextKey, params?: Params) => string;

export function unlockText(unlock: Unlock, language: string, t: T): string {
  switch (unlock.kind) {
    case "start":
      return t("unlock.start");
    case "milestone":
      return t("unlock.milestone", { tier: unlock.tier, name: localize(unlock.name, language) });
    case "mam":
      return t("unlock.mam", { tree: localize(unlock.tree, language), name: localize(unlock.name, language) });
    case "hardDrive":
      return t("unlock.hardDrive");
    case "awesomeShop":
      return t("unlock.awesomeShop", { name: localize(unlock.name, language) });
    case "other":
      return localize(unlock.name, language);
  }
}

/** One short sentence for the player, never the solver's own message. */
export function solveErrorText(error: SolveError, data: GameData, language: string, t: T): string {
  switch (error.code) {
    case "INVALID_PLAN":
      switch (error.reason) {
        case "UNKNOWN_ITEM":
          return t("error.unknownItem", { item: error.item ? itemName(data, error.item, language) : "?" });
        case "UNKNOWN_RECIPE":
          return t("error.unknownRecipe", { recipe: error.recipe ?? "?" });
        case "BAD_RATE":
          return t("error.badRate");
        case "NO_TARGETS":
          return t("error.noTargets");
      }
    case "LOCKED_RECIPE":
      return t("error.locked", { recipe: recipeName(data, error.recipe, language) });
    case "WRONG_RECIPE":
      return t("error.wrong", { recipe: recipeName(data, error.recipe, language), item: itemName(data, error.item, language) });
    case "INFEASIBLE":
      return t("error.infeasible");
  }
}

const isFluid = (data: GameData, item: ItemId) => data.items[item]?.form === "liquid" || data.items[item]?.form === "gas";

/** A rate with its unit: pieces per minute, or cubic metres per minute for fluids. */
export function rateText(data: GameData, item: ItemId, perMinute: number, locale: string, t: T): string {
  return `${formatRate(perMinute, locale)} ${t(isFluid(data, item) ? "perMinuteFluid" : "perMinute")}`;
}

/** An amount: "× 5" for pieces, "5 m³" for fluids. */
export function amountText(data: GameData, item: ItemId, amount: number, locale: string): string {
  return isFluid(data, item) ? `${formatRate(amount, locale)} m³` : `× ${formatRate(amount, locale)}`;
}
