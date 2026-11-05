import type { Component } from "vue";

/** One choice of a `SegmentedControl`. */
export interface SegmentedOption<T extends string = string> {
  value: T;
  /** What the option says. With `iconOnly` it is the option's name for screen readers and its tooltip instead. */
  label: string;
  testid?: string;
  /** A Lucide icon shown before the label. */
  icon?: Component;
  /** Shows only the icon (needs `icon`). The label becomes its tooltip and `aria-label`. */
  iconOnly?: boolean;
  /** Turns this one option off. The rest of the control keeps working. */
  disabled?: boolean;
  /**
   * A short text on why this option is off, shown as its tooltip. An option with one stays hoverable and focusable (the arrow
   * keys land on it) so the reason can be read, but it can't be picked.
   */
  disabledReason?: string;
  /** A tooltip for the option. While it is disabled, `disabledReason` shows instead. */
  tooltip?: string;
}

/** Whether the option is off but still reachable, so its tooltip can show: a disabled option with something to say. */
export function isSoftOption(option: SegmentedOption, controlDisabled = false): boolean {
  return !controlDisabled && !!option.disabled && !!(option.disabledReason?.trim() || option.tooltip?.trim());
}

/**
 * The text of the option's tooltip, or undefined for none. A disabled option says why; an icon-only one has no visible name,
 * so its label comes first (also when it has nothing else to say).
 */
export function optionHint(option: SegmentedOption): string | undefined {
  const text = (option.disabled ? option.disabledReason?.trim() || option.tooltip?.trim() : option.tooltip?.trim()) || undefined;
  if (!option.iconOnly || !option.icon) return text;
  return text ? `${option.label}: ${text}` : option.label;
}
