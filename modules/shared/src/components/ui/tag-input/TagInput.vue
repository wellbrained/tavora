<script setup lang="ts">
import type { HTMLAttributes } from "vue"
// reka's own input, not the kit's ComboboxInput: that one brings a search icon, a clear button and a full-width box,
// none of which belongs between the chips. Its free-mode keys (freeKeys) and Field wiring are used here the same way.
import { ComboboxInput as ComboboxInputPrimitive } from "reka-ui"
import { computed, nextTick, ref, watch } from "vue"
import { cn } from "../../../lib/utils"
import { Chip } from "../chip"
import { Combobox, ComboboxAnchor, ComboboxItem, ComboboxList } from "../combobox"
import { freeKeys } from "../combobox/free-keys"
import { useFieldControl } from "../field/use-field-control"
import { uiText } from "../text"
import { chipKey, freshTag, splitPaste, suggestionsFor, tagsToAdd } from "./tags"

defineOptions({
  inheritAttrs: false,
})

// Tags as chips inside one field, with a list of suggestions under it.
// - `free` (the default): Enter or a comma adds what is typed, and a paste with commas or new lines adds each part;
//   the list helps, its first row offers "Add “…”". Without `free` only a suggestion can be picked (a filter).
// - A tag that is there already (in any case) isn't added twice; `max` stops adding and says so in the field.
// - Backspace in an empty field marks the last chip, a second press removes it; ←/→ move the mark, Delete removes the
//   marked chip, Escape or typing drops it. The chips' × are for the mouse; Tab goes from the field to the next control.
// v-model is the list; `add` and `remove` say what changed, one tag each, for a module that replays edits.
// A text size from the scale by class (text-sm, text-base, text-lg) sizes the chips, and they grow with it; what you
// type is never smaller than the kit's body text.
const props = withDefaults(defineProps<{
  suggestions?: readonly string[]
  free?: boolean
  max?: number
  /** The most characters one tag can have. */
  maxlength?: number
  placeholder?: string
  /** Shown in the field when `max` is reached. */
  fullText?: string
  size?: "default" | "lg"
  disabled?: boolean
  class?: HTMLAttributes["class"]
}>(), {
  suggestions: () => [],
  free: true,
  size: "default",
})

const tags = defineModel<string[]>({ default: () => [] })
const emit = defineEmits<{ add: [tag: string], remove: [tag: string] }>()

const text = ref("")
const open = ref(false)
/** The chip Backspace or Delete would remove, or null while the caret is in the field. */
const mark = ref<number | null>(null)
/** What the screen reader is told: a chip marked, added or removed. */
const said = ref("")

const anchor = ref<{ $el?: HTMLElement } | null>(null)
const input = () => anchor.value?.$el?.querySelector<HTMLInputElement>("input") ?? null
const field = useFieldControl({ element: input, value: () => (tags.value.length ? tags.value : "") })

const full = computed(() => props.max !== undefined && tags.value.length >= props.max)
const shown = computed(() => (full.value ? [] : suggestionsFor(props.suggestions, tags.value, text.value)))
const fresh = computed(() => (props.free && !full.value ? freshTag(text.value, tags.value, props.suggestions, props.maxlength) : ""))
const hasList = computed(() => shown.value.length > 0 || fresh.value !== "")
const placeholder = computed(() => (full.value ? (props.fullText ?? uiText.value.tagsFull.replace("{max}", String(props.max))) : props.placeholder))

// The chips change from outside (an undo, another copy): a mark past the end means nothing any more.
watch(() => tags.value.length, (count) => {
  if (mark.value !== null && mark.value >= count) mark.value = null
})
watch(full, (isFull) => {
  if (isFull) open.value = false
})

const keys = freeKeys()

function add(texts: readonly string[]) {
  const added = tagsToAdd(tags.value, texts, { max: props.max, maxlength: props.maxlength })
  text.value = ""
  keys.reset()
  if (!added.length) return
  tags.value = [...tags.value, ...added]
  for (const tag of added) emit("add", tag)
  said.value = added.map((tag) => uiText.value.tagAdded.replace("{tag}", tag)).join(". ")
}

function removeAt(index: number) {
  const tag = tags.value[index]
  if (tag === undefined || props.disabled) return
  tags.value = tags.value.filter((_, at) => at !== index)
  emit("remove", tag)
  said.value = uiText.value.tagRemoved.replace("{tag}", tag)
}

function setMark(next: number | null) {
  mark.value = next
  const tag = next === null ? undefined : tags.value[next]
  if (tag !== undefined) said.value = uiText.value.tagMarked.replace("{tag}", tag)
  if (next !== null) open.value = false
}

function onKey(event: KeyboardEvent) {
  const target = event.target as HTMLInputElement
  const result = chipKey(event, { mark: mark.value, count: tags.value.length, empty: target.value === "" })
  if (result.handled) {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (result.remove !== undefined) removeAt(result.remove)
    setMark(result.mark)
    return
  }
  if (mark.value !== null) mark.value = result.mark
  if (!props.free || full.value) return
  // Nothing typed: Enter and the comma do what they would anywhere else (a form's Enter, for one).
  if (!target.value.trim()) return
  if (event.key === "," && !event.isComposing) {
    event.preventDefault()
    add([target.value])
    return
  }
  if (keys.press(event) === "commit") {
    event.preventDefault()
    event.stopImmediatePropagation()
    add([target.value])
  }
}

function onPaste(event: ClipboardEvent) {
  if (!props.free || full.value) return
  const parts = splitPaste(event.clipboardData?.getData("text/plain") ?? "")
  if (!parts) return
  event.preventDefault()
  add(parts)
}

/** A suggestion or the "Add …" row was picked. */
function pick(value: unknown) {
  if (typeof value === "string" && value) add([value])
  if (full.value) open.value = false
}

function openList() {
  if (!full.value && !props.disabled) open.value = true
}

// A press on the field around the chips puts the caret in it, as a plain input would.
function onBoxDown(event: PointerEvent) {
  if (props.disabled || (event.target as Element).closest("input, button")) return
  event.preventDefault()
  input()?.focus()
  openList()
}

function onChipRemove(index: number) {
  removeAt(index)
  mark.value = null
  void nextTick(() => input()?.focus())
}
</script>

<template>
  <Combobox
    v-model:open="open"
    :model-value="''"
    ignore-filter
    :reset-search-term-on-blur="false"
    :disabled="disabled"
    @update:model-value="pick"
  >
    <ComboboxAnchor
      ref="anchor"
      data-slot="tag-input"
      :data-disabled="disabled ? '' : undefined"
      :class="cn(
        size === 'lg' ? 'text-sm' : 'text-xs',
        'border-input dark:bg-input/10 flex w-full min-w-0 flex-wrap items-center gap-1 rounded-md border bg-transparent shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-3',
        size === 'lg' ? 'min-h-[calc(var(--style-control-height,32px)+8px)] px-1.5 py-1.5' : 'min-h-[var(--style-control-height,32px)] px-1 py-1',
        disabled && 'cursor-not-allowed opacity-(--disabled-opacity)',
        props.class,
      )"
      @pointerdown="onBoxDown"
    >
      <Chip
        v-for="(tag, index) in tags"
        :key="`${index}:${tag}`"
        :label="tag"
        :size="size"
        class="text-[length:inherit]"
        :marked="mark === index"
        :removable="!disabled"
        :remove-tabbable="false"
        @mousedown.prevent
        @remove="onChipRemove(index)"
      />
      <ComboboxInputPrimitive
        v-model="text"
        data-slot="tag-input-field"
        v-bind="{ ...$attrs, ...field.attrs() }"
        autocomplete="off"
        spellcheck="false"
        :readonly="full"
        :disabled="disabled"
        :maxlength="maxlength"
        :placeholder="tags.length && !full ? undefined : placeholder"
        :class="cn(
          'placeholder:text-muted-foreground min-w-20 flex-1 bg-transparent px-1.5 text-[length:max(1em,var(--text-base))] leading-normal outline-none disabled:cursor-not-allowed',
          full && 'placeholder:text-xs',
        )"
        @keydown.capture="onKey"
        @paste="onPaste"
        @input="openList"
        @click="openList"
        @keydown.down="openList"
        @blur="mark = null; keys.reset()"
      />
    </ComboboxAnchor>
    <ComboboxList v-if="hasList" align="start">
      <ComboboxItem v-if="fresh" :value="fresh" data-slot="tag-input-add">
        {{ uiText.addTag.replace("{tag}", fresh) }}
      </ComboboxItem>
      <ComboboxItem v-for="suggestion in shown" :key="suggestion" :value="suggestion">
        {{ suggestion }}
      </ComboboxItem>
    </ComboboxList>
    <span class="sr-only" aria-live="polite">{{ said }}</span>
  </Combobox>
</template>
