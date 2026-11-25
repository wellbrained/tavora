import { checkTooltip as checkTooltipParams, checkTooltipAnchor as checkAnchorParams, checkTooltipId, type ParamCheck, type TooltipAnchor, type TooltipRequest } from "@tavora/sdk/protocol";
import { HostError } from "./errors";

// A tooltip's params, by the SDK's shared checks (`@tavora/sdk/protocol`), which the memory host of
// `@tavora/sdk/testing` uses too: only known fields, text as text, pictures from the module's own bundle.

function checked<T>(result: ParamCheck<T>): T {
  if (!result.ok) throw new HostError(result.code, result.message);
  return result.value;
}

export const tooltipId = (v: unknown): string => checked(checkTooltipId(v));
export const checkTooltipAnchor = (v: unknown): TooltipAnchor => checked(checkAnchorParams(v));
export const checkTooltip = (v: unknown): TooltipRequest => checked(checkTooltipParams(v));
