import { ref } from "vue";
import { resource } from "./api";
import type { Summary } from "./types";

// To add a section (Stats, Approval): a component in sections/, an id here and an entry in App.vue's SECTIONS.
export type SectionId = "overview" | "updates" | "modules" | "review" | "accounts" | "status";

const SAVED = "adminSection";
const IDS: SectionId[] = ["overview", "updates", "modules", "review", "accounts", "status"];
const saved = sessionStorage.getItem(SAVED);

export const section = ref<SectionId>(IDS.includes(saved as SectionId) ? (saved as SectionId) : "overview");
/** The Review section's open tab; the Overview's "waiting" lines open a section at a tab. */
export const reviewTab = ref("pending");

export function go(next: string, tab?: string): void {
  if (!IDS.includes(next as SectionId)) return;
  section.value = next as SectionId;
  sessionStorage.setItem(SAVED, next);
  if (tab) reviewTab.value = tab;
}

/** Goes up when Refresh is pressed; every open section reloads on it. */
export const refreshTick = ref(0);

/** What waits for the maintainer; the Overview and the navigation's counts read it. */
export const summary = resource<Summary>("/api/summary");
