<script setup lang="ts">
// The options of a dropdown format: what the cells can hold, each with an optional colour (it shows as a pill).
import { ListChecks, Plus, X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { Dialog, DialogButton, DialogContent, DialogFooter, DialogHeader } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { computed, ref, watch } from "vue";
import { t } from "./i18n";
import { COLORS, type ColorName, type DropdownOption } from "./model";

const props = defineProps<{ options: DropdownOption[] }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ save: [options: DropdownOption[]] }>();

const rows = ref<{ key: number; value: string; color: string }[]>([]);
let next = 0;
const fromOptions = (options: DropdownOption[]) => (options.length ? options : [{ value: "", color: null }]).map((option) => ({ key: next++, value: option.value, color: option.color ? `var(--${option.color})` : "transparent" }));
watch(open, (isOpen) => isOpen && (rows.value = fromOptions(props.options)), { immediate: true });

// "No colour" first, as an empty swatch, so a colour can be taken off again.
const swatches = ["transparent", ...COLORS.map((name) => `var(--${name})`)];
const swatchLabels = computed(() => [t("colors.none"), ...COLORS.map((name) => t(`color.${name}`))]);
const nameOf = (value: string) => (/^var\(--(.+)\)$/.exec(value)?.[1] as ColorName | undefined) ?? null;

function save() {
  const seen = new Set<string>();
  const options = rows.value
    .map((row) => ({ value: row.value.trim().slice(0, 80), color: nameOf(row.color) }))
    .filter((option) => option.value && !seen.has(option.value) && seen.add(option.value));
  emit("save", options.slice(0, 50));
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader :icon="ListChecks" :title="t('dropdown.title')" :description="t('dropdown.text')" />
      <form class="contents" @submit.prevent="save">
        <div class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          <div v-for="(row, index) in rows" :key="row.key" class="flex items-center gap-2">
            <Input v-model="row.value" class="h-8 min-w-0 flex-1" :aria-label="t('dropdown.option', { number: index + 1 })" :maxlength="80" />
            <ColorPicker v-model="row.color" :colors="swatches" :labels="swatchLabels" :label="t('dropdown.color', { name: row.value || String(index + 1) })" class="flex-none" />
            <Button type="button" variant="ghost" size="icon-sm" :aria-label="t('dropdown.remove')" :title="t('dropdown.remove')" :disabled="rows.length <= 1" @click="rows.splice(index, 1)"><X :stroke-width="1.5" /></Button>
          </div>
          <Button type="button" variant="ghost" size="sm" class="self-start" :disabled="rows.length >= 50" @click="rows.push({ key: next++, value: '', color: 'transparent' })"><Plus :stroke-width="1.5" /> {{ t("dropdown.add") }}</Button>
        </div>
        <DialogFooter>
          <DialogButton close>{{ t("cancel") }}</DialogButton>
          <DialogButton type="submit">{{ t("save") }}</DialogButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
