<script setup lang="ts">
import { Link, Save, Trash2 } from "@lucide/vue";
import { Dialog, DialogButton, DialogContent, DialogFooter, DialogHeader } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ref } from "vue";
import { t } from "./i18n";
import { normalizeLink } from "./notes";

const props = defineProps<{ initial: string }>();
const emit = defineEmits<{ apply: [href: string | null]; cancel: [] }>();

const value = ref(props.initial);
const error = ref("");

function submit() {
  if (!value.value.trim()) return emit("apply", null);
  const href = normalizeLink(value.value);
  if (!href) {
    error.value = t("link.invalid");
    return;
  }
  emit("apply", href);
}
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('cancel')">
    <DialogContent class="top-[12vh] translate-y-0 sm:max-w-[420px]" data-testid="link-dialog">
      <DialogHeader :icon="Link" :title="initial ? t('link.edit') : t('link.add')" :description="t('link.help')" />
      <form class="contents" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
        <Input
          v-model="value"
          data-testid="link-input"
          placeholder="https://"
          :aria-label="t('link.address')"
          :aria-invalid="error ? true : undefined"
          autofocus
          @update:model-value="error = ''"
        />
        <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
        </div>
        <DialogFooter>
          <DialogButton v-if="initial" type="button" variant="danger" :icon="Trash2" class="mr-auto" @click="emit('apply', null)">
            {{ t("link.remove") }}
          </DialogButton>
          <DialogButton type="button" close @click="emit('cancel')">{{ t("cancel") }}</DialogButton>
          <DialogButton type="submit" :icon="Save" data-testid="link-submit">{{ t("link.save") }}</DialogButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
