import type { Component } from "vue";

export interface NavItem {
  id: string;
  label: string;
  icon?: Component;
  /** How far the entry is indented, for a flat list that shows a hierarchy (0 or none: not at all). */
  level?: number;
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
  /** Draws the heading inside a divider line (a thin line each side of the label, more room above), for a group that is a section of its own such as a module's Overlays. */
  divider?: boolean;
  /** A small icon before the heading. */
  icon?: Component;
  items: NavItem[];
  /** Classes for this group's box, on top of the list's `groupClass` (e.g. a colour of its own). */
  class?: string;
}
