<script setup lang="ts">
// The Calculator's settings: one page, so there is no menu, no Done button and no title bar of its own. Tavora shows them as
// a dialog over the workspace (`page`: the panel itself is that dialog, so this is its whole page); an older Tavora gets the
// same page in a dialog in the middle of the panel.
import { SlidersHorizontal } from "@lucide/vue";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { ModuleSettings } from "@tavora/official-ui/components/ui/module-settings";
import { computed } from "vue";
import { t } from "./i18n";
import SettingsRows from "./SettingsRows.vue";

defineProps<{
  short: boolean;
  page?: boolean;
  /** When something was last saved (Date.now()), for the footer's "Saved". */
  savedAt?: number;
  /** Puts the three settings back to their defaults; returns what undoes it. */
  reset: () => () => void;
}>();
const emit = defineEmits<{ "update:short": [on: boolean]; close: [] }>();
const decimals = defineModel<string>("decimals", { required: true });
const historyLength = defineModel<string>("historyLength", { required: true });

const PAGE = "settings";
const groups = computed(() => [{ items: [{ id: PAGE, label: t("options.title"), icon: SlidersHorizontal }] }]);
</script>

<template>
  <ModuleSettings v-if="page" :page="PAGE" :groups="groups" :label="t('options.title')" :reset="reset" :saved-at="savedAt" data-testid="settings-dialog">
    <SettingsRows v-model:decimals="decimals" v-model:history-length="historyLength" :short="short" @update:short="(on: boolean) => emit('update:short', on)" />
  </ModuleSettings>
  <Dialog v-else :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent class="h-[min(32rem,calc(100vh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-[420px]" data-testid="settings-dialog">
      <DialogTitle class="sr-only">{{ t("options.title") }}</DialogTitle>
      <DialogDescription class="sr-only">{{ t("options.about") }}</DialogDescription>
      <ModuleSettings :page="PAGE" :groups="groups" :label="t('options.title')" :reset="reset" :saved-at="savedAt">
        <SettingsRows v-model:decimals="decimals" v-model:history-length="historyLength" :short="short" stacked @update:short="(on: boolean) => emit('update:short', on)" />
      </ModuleSettings>
    </DialogContent>
  </Dialog>
</template>
