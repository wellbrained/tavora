<script setup lang="ts">
// A one-line text with {placeholders} in it: the ones the field knows are marked inside the text, a {name} it doesn't know
// is underlined. `insert` puts a placeholder (or any text) at the cursor, for a row of chips beside the field. It is the kit's
// Input with a mark layer behind the text, so it looks and behaves like one: `id`, `aria-label`, `class` and listeners go to the input.
import { computed, nextTick, useTemplateRef } from "vue";
import { cn } from "../../../lib/utils";
import { Input } from "../input";

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  /** The placeholder names the field knows, without braces; compared without regard to case. */
  known: string[];
  maxlength?: number;
  placeholder?: string;
  invalid?: boolean;
}>();
const text = defineModel<string>({ required: true });

type Mark = { text: string; kind: "plain" | "known" | "unknown" };

/** `{{` and `}}` are plain braces; a `{name}` is a placeholder. */
const marks = computed<Mark[]>(() => {
  const known = new Set(props.known.map((name) => name.toLowerCase()));
  const result: Mark[] = [];
  let last = 0;
  for (const match of text.value.matchAll(/\{\{|\}\}|\{[^{}]*\}/g)) {
    const at = match.index ?? 0;
    if (at > last) result.push({ text: text.value.slice(last, at), kind: "plain" });
    const word = match[0];
    result.push({ text: word, kind: word === "{{" || word === "}}" ? "plain" : known.has(word.slice(1, -1).trim().toLowerCase()) ? "known" : "unknown" });
    last = at + word.length;
  }
  if (last < text.value.length) result.push({ text: text.value.slice(last), kind: "plain" });
  return result;
});

const field = useTemplateRef<{ $el: HTMLInputElement }>("field");
const layer = useTemplateRef<HTMLElement>("layer");
/** The marks follow the text when it scrolls sideways inside the field. */
const follow = () => {
  if (layer.value && field.value) layer.value.scrollLeft = field.value.$el.scrollLeft;
};

/** Puts `value` where the cursor is (in place of what is selected) and keeps the focus in the field. */
async function insert(value: string): Promise<void> {
  const input = field.value?.$el;
  const start = input?.selectionStart ?? text.value.length;
  const end = input?.selectionEnd ?? start;
  text.value = text.value.slice(0, start) + value + text.value.slice(end);
  await nextTick();
  input?.focus();
  input?.setSelectionRange(start + value.length, start + value.length);
  follow();
}

defineExpose({ insert, focus: () => field.value?.$el.focus() });
</script>

<template>
  <div class="relative w-full" data-slot="template-input">
    <div ref="layer" class="pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-md border border-transparent px-3 py-1 text-base" aria-hidden="true">
      <span class="whitespace-pre text-transparent">
        <span
          v-for="(mark, index) in marks"
          :key="index"
          :class="cn(mark.kind === 'known' && 'bg-primary/25 rounded-sm', mark.kind === 'unknown' && 'decoration-destructive underline decoration-wavy underline-offset-4')"
          :data-mark="mark.kind"
          >{{ mark.text }}</span
        >
      </span>
    </div>
    <Input
      v-bind="$attrs"
      ref="field"
      v-model="text"
      :class="cn('relative', $attrs.class as string | undefined)"
      :maxlength="maxlength"
      :placeholder="placeholder"
      :aria-invalid="invalid || undefined"
      @input="follow"
      @scroll="follow"
      @keyup="follow"
      @click="follow"
      @select="follow"
    />
  </div>
</template>
