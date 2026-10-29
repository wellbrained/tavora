<script setup lang="ts">
// A module's settings, shown in its dialog over Tavora (panel.openDialog): pages on the left (the
// module's own first, then an Overlays group with an on/off dot per overlay), the open page on the
// right, and a footer to reset the page and see that changes are saved. Changes apply at once.
// Each page is a SettingsPage. Undo after a reset shows as a toast, so the page needs a Toaster.
import { Check, RotateCcw } from "@lucide/vue";
import { onBeforeUnmount, ref, watch } from "vue";
import { Button } from "../button";
import { NavList, type NavGroup } from "../nav-list";
import { uiText } from "../text";
import { toast } from "../toast";

const props = defineProps<{
  groups: NavGroup[];
  /** The menu's name for screen readers, such as "Settings". */
  label: string;
  /** Puts the open page back to its defaults; return a function that undoes it to offer Undo. Without it there is no reset button. */
  reset?: (page: string) => (() => void) | void;
  /** When something was last saved (Date.now()); a new value shows "Saved" for a moment. */
  savedAt?: number;
}>();
const page = defineModel<string>("page", { required: true });

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
  <div class="flex h-full min-h-0" data-slot="module-settings" data-testid="module-settings">
    <NavList v-model="page" :groups="groups" :label="label" class="bg-background w-[200px] flex-none overflow-y-auto border-r p-3" />
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col"><slot /></div>
      <footer class="text-muted-foreground flex h-12 flex-none items-center gap-2 border-t pr-6 pl-4 text-xs">
        <Button v-if="reset" variant="ghost" size="sm" class="text-muted-foreground" data-testid="settings-reset" @click="resetPage">
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
