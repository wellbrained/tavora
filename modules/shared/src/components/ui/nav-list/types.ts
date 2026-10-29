import type { Component } from "vue";

export interface NavItem {
  id: string;
  label: string;
  icon?: Component;
  /** A small number or word at the end, such as a count. */
  badge?: string | number;
  /** Draws the badge as a filled tag, for something that wants attention. */
  badgeAccent?: boolean;
  /** A small dot at the end for something that is on or off, such as an overlay; `statusLabel` names it for screen readers. */
  status?: "on" | "off";
  statusLabel?: string;
  /** Shown on hover as a hint. */
  title?: string;
  testid?: string;
  /** A test id for the badge. */
  badgeTestid?: string;
}

export interface NavGroup {
  /** A small heading above the group. */
  heading?: string;
  items: NavItem[];
}
