// Hover tooltips through Tavora's shared tooltip (ui.tooltip), so they are
// never cut off at the panel's edge. `v-tip="() => content"` on any element.

import type { TavoraSDK, TooltipContent } from "@tavora/sdk";
import type { Directive } from "vue";
import type { GameData, ItemId, RecipeId } from "../contracts/data";
import { amountText, rateText, unlockText, type T } from "./describe";
import { formatNumber, formatPower } from "./format";
import { buildingName, itemName, localize } from "./names";
import { perMinute } from "./planEdit";

type ContentFn = () => TooltipContent | null;
type TipElement = HTMLElement & { __tip?: { content: ContentFn; off: () => void } };

/** Tooltip pictures are paths inside the module; the page and its icons live in dist/. */
export const tooltipImage = (icon: string | undefined) => (icon ? `dist/${icon}` : undefined);

export function createTipDirective(sdk: TavoraSDK): Directive<TipElement, ContentFn> {
  let serial = 0;
  let current: { id: string; element: HTMLElement } | null = null;

  const hide = (element?: HTMLElement) => {
    if (!current || (element && current.element !== element)) return;
    void sdk.ui.tooltip.hide(current.id).catch(() => undefined);
    current = null;
  };
  const show = (element: TipElement, at: { x: number; y: number }) => {
    const content = element.__tip?.content();
    hide();
    if (!content) return;
    const id = `tip-${++serial}`;
    current = { id, element };
    void sdk.ui.tooltip.show({ id, at: { x: Math.max(0, at.x), y: Math.max(0, at.y) }, content }).catch(() => undefined);
  };

  return {
    mounted(element, binding) {
      const enter = (event: PointerEvent) => show(element, { x: event.clientX, y: event.clientY });
      const move = (event: PointerEvent) => {
        if (current?.element === element) void sdk.ui.tooltip.move({ id: current.id, at: { x: event.clientX, y: event.clientY } }).catch(() => undefined);
      };
      const focus = () => {
        if (!element.matches(":focus-visible")) return;
        const box = element.getBoundingClientRect();
        show(element, { x: box.left + box.width / 2, y: box.bottom });
      };
      const leave = () => hide(element);
      element.addEventListener("pointerenter", enter);
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerleave", leave);
      element.addEventListener("pointerdown", leave);
      element.addEventListener("focus", focus);
      element.addEventListener("blur", leave);
      element.__tip = {
        content: binding.value,
        off: () => {
          element.removeEventListener("pointerenter", enter);
          element.removeEventListener("pointermove", move);
          element.removeEventListener("pointerleave", leave);
          element.removeEventListener("pointerdown", leave);
          element.removeEventListener("focus", focus);
          element.removeEventListener("blur", leave);
        },
      };
    },
    updated(element, binding) {
      if (element.__tip) element.__tip.content = binding.value;
    },
    beforeUnmount(element) {
      hide(element);
      element.__tip?.off();
    },
  };
}

/** What an item is, at a glance. */
export function itemTooltip(data: GameData, id: ItemId, language: string, locale: string, t: T): TooltipContent | null {
  const item = data.items[id];
  if (!item) return null;
  const properties: { label: string; value: string }[] = [];
  if (item.stackSize !== undefined) properties.push({ label: t("codex.stack"), value: formatNumber(item.stackSize, locale) });
  properties.push({ label: t("codex.sink"), value: item.sinkPoints !== undefined ? formatNumber(item.sinkPoints, locale) : t("codex.sinkNone") });
  if (item.energyMJ !== undefined) properties.push({ label: t("codex.energy"), value: `${formatNumber(item.energyMJ, locale)} MJ` });
  const image = tooltipImage(item.icon);
  return {
    title: localize(item.name, language),
    subtitle: `${t(`kind.${item.kind}`)} · ${t(`form.${item.form}`)}`,
    ...(image ? { image } : {}),
    properties,
  };
}

/** A recipe's ins and outs per minute at 100 % clock, its building and how it unlocks. */
export function recipeTooltip(data: GameData, id: RecipeId, language: string, locale: string, t: T): TooltipContent | null {
  const recipe = data.recipes[id];
  if (!recipe) return null;
  const line = (entry: { item: ItemId; amount: number }) => ({
    text: `${itemName(data, entry.item, language)}  ${amountText(data, entry.item, entry.amount, locale)}  (${rateText(data, entry.item, perMinute(recipe, entry.amount), locale, t)})`,
  });
  const building = recipe.producedIn[0];
  const power = recipe.variablePowerMW
    ? `${formatPower(recipe.variablePowerMW.min, locale)} – ${formatPower(recipe.variablePowerMW.max, locale)}`
    : building && data.buildings[building]?.powerMW !== undefined
      ? formatPower(data.buildings[building]!.powerMW!, locale)
      : null;
  return {
    title: localize(recipe.name, language),
    ...(recipe.alternate ? { badges: [t("codex.alternate")] } : {}),
    properties: [
      ...(building ? [{ label: t("codex.madeIn"), value: buildingName(data, building, language) }] : []),
      { label: t("codex.time"), value: t("codex.duration", { seconds: formatNumber(recipe.durationSeconds, locale) }) },
      ...(power ? [{ label: t("codex.power"), value: power }] : []),
      {
        label: t("codex.unlock"),
        value: recipe.unlockedBy.length ? recipe.unlockedBy.map((unlock) => unlockText(unlock, language, t)).join(", ") : t("unlock.unknown"),
      },
    ],
    sections: [
      { title: t("codex.ingredients"), rows: recipe.ingredients.map(line) },
      { title: t("codex.products"), rows: recipe.products.map(line) },
    ],
  };
}
