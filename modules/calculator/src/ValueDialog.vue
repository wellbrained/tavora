<script setup lang="ts">
// Save as… and Rename for a saved value: one name field, checked as you type. Saving under a name you already have
// replaces that value (the dialog says so first); renaming onto another value's name is not allowed.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { computed, ref } from "vue";
import { t } from "./i18n";
import { isValidName, MAX_NAME, MAX_VALUES, sameName, type Value } from "./values";

const props = defineProps<{
  values: Value[];
  /** The number being saved, as shown; for Save as. */
  shown?: string;
  /** The value being renamed; for Rename. */
  renaming?: string;
}>();
const emit = defineEmits<{ submit: [name: string]; cancel: [] }>();

const name = ref(props.renaming ?? "");

const existing = computed(() => props.values.find((value) => sameName(value.name, name.value.trim())));
const problem = computed(() => {
  const trimmed = name.value.trim();
  if (!trimmed) return null;
  if (!isValidName(trimmed)) return t("values.badName");
  if (props.renaming !== undefined) return existing.value && !sameName(existing.value.name, props.renaming) ? t("values.taken") : null;
  return !existing.value && props.values.length >= MAX_VALUES ? t("values.full") : null;
});
const replaces = computed(() => (props.renaming === undefined && !problem.value && existing.value ? existing.value.name : null));

function submit() {
  const trimmed = name.value.trim();
  if (!trimmed || problem.value) return;
  emit("submit", trimmed);
}
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('cancel')">
    <DialogContent class="top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]" data-testid="value-dialog" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ renaming !== undefined ? t("values.renameTitle", { name: renaming }) : t("values.saveTitle") }}</DialogTitle>
        <DialogDescription v-if="shown !== undefined">{{ t("values.saveText", { value: shown }) }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-2" @submit.prevent="submit">
        <Input
          v-model="name"
          data-testid="value-name"
          :maxlength="MAX_NAME"
          :aria-label="t('values.name')"
          :placeholder="t('values.name')"
          :aria-invalid="problem ? true : undefined"
          autocomplete="off"
          autofocus
        />
        <p v-if="problem" class="text-destructive text-sm" role="alert">{{ problem }}</p>
        <p v-else-if="replaces" class="text-muted-foreground text-sm">{{ t("values.replaces", { name: replaces }) }}</p>
        <div class="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" @click="emit('cancel')">{{ t("cancel") }}</Button>
          <Button type="submit" :disabled="!name.trim() || !!problem" data-testid="value-submit">
            {{ renaming !== undefined ? t("values.rename") : t("values.save") }}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
