import type { Component } from "vue";

/** One button of a ToggleGroup. */
export interface ToggleGroupOption<T extends string = string> {
  value: T;
  /** Its name for screen readers, and its tooltip when the button's words don't say it. */
  label: string;
  icon?: Component;
  /** Words on the button: next to the icon, or alone ("B" for Bold). */
  text?: string;
  testid?: string;
  /** Turns this one button off; the rest keep working. */
  disabled?: boolean;
  /** Why it is off, shown as its tooltip. With one it stays hoverable and focusable. */
  disabledReason?: string;
}
