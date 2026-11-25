import { checkMenu as checkMenuParams, type CheckedMenu } from "@tavora/sdk/protocol";
import { HostError } from "./errors";

// A menu a module asks Tavora to draw (ui.showMenu). The SDK's shared check (`@tavora/sdk/protocol`, which the memory
// host of `@tavora/sdk/testing` uses too) rebuilds it from known fields only: text stays text, colours are plain CSS
// colour values, and the host UI only ever sees this checked copy.

export type { CheckedMenu };

export function checkMenu(params: unknown): CheckedMenu {
  const checked = checkMenuParams(params);
  if (!checked.ok) throw new HostError(checked.code, checked.message);
  return checked.value;
}
