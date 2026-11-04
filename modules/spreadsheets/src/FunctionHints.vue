<script setup lang="ts">
// Function names for the formula being typed, in the kit's popover next to the field (the formula bar or the cell
// editor). The field keeps the focus: ↑ and ↓ pick, Enter or Tab puts the function in, Esc closes the list.
import { Popover, PopoverAnchor, PopoverContent } from "@tavora/official-ui/components/ui/popover";
import { computed, ref, watch } from "vue";
import { functionWord, insertFunction, suggest } from "./autocomplete";
import { t } from "./i18n";

const props = defineProps<{ field: HTMLInputElement | HTMLTextAreaElement | null; text: string; caret: number; active: boolean }>();
const emit = defineEmits<{ insert: [text: string, caret: number] }>();

const dismissed = ref<string | null>(null);
const word = computed(() => (props.active ? functionWord(props.text, props.caret) : null));
const names = computed(() => (word.value ? suggest(word.value.prefix) : []));
const open = computed(() => names.value.length > 0 && dismissed.value !== props.text);
const highlighted = ref(0);
watch(names, () => (highlighted.value = 0));

function pick(name: string) {
  if (!word.value) return;
  const next = insertFunction(props.text, word.value, props.caret, name);
  emit("insert", next.text, next.caret);
}

/** Takes the keys the list needs while it is open; true when it took one. */
function handleKey(event: KeyboardEvent): boolean {
  if (!open.value) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const step = event.key === "ArrowDown" ? 1 : -1;
    highlighted.value = (highlighted.value + step + names.value.length) % names.value.length;
  } else if (event.key === "Enter" || event.key === "Tab") pick(names.value[highlighted.value]!);
  else if (event.key === "Escape") dismissed.value = props.text;
  else return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

defineExpose({ handleKey });
</script>

<template>
  <Popover :open="open" @update:open="(next) => !next && (dismissed = text)">
    <PopoverAnchor :reference="field ?? undefined" />
    <PopoverContent
      side="bottom"
      align="start"
      :side-offset="4"
      class="w-48 p-1"
      data-grid-keep-edit
      @open-auto-focus.prevent
      @close-auto-focus.prevent
      @mousedown.prevent
    >
      <ul role="listbox" :aria-label="t('functions')" class="flex flex-col">
        <li
          v-for="(name, index) in names"
          :key="name"
          role="option"
          :aria-selected="index === highlighted"
          :class="['cursor-pointer rounded-sm px-2 py-1 font-mono text-sm', index === highlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60']"
          @click="pick(name)"
        >
          {{ name }}
        </li>
      </ul>
    </PopoverContent>
  </Popover>
</template>
