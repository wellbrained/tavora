<script setup lang="ts">
// A module's settings, shown in its dialog over Tavora (panel.openDialog): pages on the left (the
// module's own first, then an Overlays group under a divider heading, see `settingsMenu`), the open
// page on the right, and a footer to reset the page and see that changes are saved. Changes apply at once.
// Each page is a SettingsPage. Undo after a reset shows as a toast, so the page needs a Toaster.
// With only one page there is no menu: the rows sit straight on the dialog, which asks for a narrower size
// (settingsDialogSize({ pages: 1 }) for panel.openDialog). There is no Done button; the dialog's close button is enough.
import { Check, RotateCcw } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Button } from "../button";
import { NavList, type NavGroup } from "../nav-list";
import { uiText } from "../text";
import { usePageMotion } from "../motion";
import { toast } from "../toast";

const props = defineProps<{
  groups: NavGroup[];
  /** The menu's name for screen readers, such as "Settings". */
  label: string;
  /** Puts the open page back to its defaults; return a function that undoes it to offer Undo. Without it there is no reset button. */
  reset?: (page: string) => (() => void) | void;
  /** Whether Reset this page shows on a page; without it, on every page. For pages that hold nothing to reset (hotkeys, a link). */
  resettable?: (page: string) => boolean;
  /** When something was last saved (Date.now()); a new value shows "Saved" for a moment. */
  savedAt?: number;
}>();
const page = defineModel<string>("page", { required: true });
/** A group with a heading is a section of its own, so its heading sits in a divider line in every module's settings. */
const menu = computed(() => props.groups.map((group) => (group.heading ? { divider: true, ...group } : group)));

/** Only one page: no menu to pick from. */
const single = computed(() => props.groups.reduce((count, group) => count + group.items.length, 0) <= 1);

// The page picked takes the old one's place: it fades in and settles from 4px below (a pick by key stays instant).
const holder = ref<HTMLElement>();
const { play } = usePageMotion(holder);
watch(page, play, { flush: "post" });

const justSaved = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.savedAt,
  () => {
    justSaved.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (justSaved.value = false), 2000);
  },
);
onBeforeUnmount(() => clearTimeout(timer));

function resetPage() {
  const undo = props.reset?.(page.value);
  if (undo) toast({ title: uiText.value.pageReset, action: { label: uiText.value.undo, onClick: undo }, testid: "settings-reset-toast", actionTestid: "settings-reset-undo" });
}
</script>

<template>
  <div class="flex h-full min-h-0" data-slot="module-settings" :data-single="single ? '' : undefined" data-testid="module-settings">
    <NavList v-if="!single" v-model="page" :groups="menu" :label="label" class="bg-background w-[200px] flex-none overflow-y-auto border-r p-3" />
    <div class="flex min-w-0 flex-1 flex-col">
      <div ref="holder" class="flex min-h-0 flex-1 flex-col"><slot /></div>
      <footer class="text-muted-foreground flex h-12 flex-none items-center gap-2 border-t pr-6 pl-4 text-xs">
        <Button v-if="reset && (resettable?.(page) ?? true)" variant="ghost" size="sm" class="text-muted-foreground" data-testid="settings-reset" @click="resetPage">
          <RotateCcw :stroke-width="1.75" />
          {{ uiText.resetPage }}
        </Button>
        <p class="ml-auto" role="status" data-testid="settings-saved">
          <span v-if="justSaved" class="text-foreground flex items-center gap-1.5"><Check class="text-success size-3.5" :stroke-width="2.25" aria-hidden="true" />{{ uiText.saved }}</span>
          <span v-else>{{ uiText.autosave }}</span>
        </p>
      </footer>
    </div>
  </div>
</template>
