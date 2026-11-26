<script setup lang="ts">
// The big search field of a palette (Ctrl+K, an "Add …" picker): a magnifier, large text, no frame. `variant="bar"`
// (the default) is the palette's top line, with a line under it; `variant="field"` stands on its own, framed, as on a
// start page. With `list` (the PaletteList's id) it is the list's combobox: the focus stays here and `activeId` names
// the lit row for screen readers. Escape is left to what is around it (a dialog closes), it doesn't clear the text.
// Slots: `icon` (in place of the magnifier) and `trailing` (a switch, a key hint). Attributes go to the input.
import { Search } from "@lucide/vue"
import { ref, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  /** The id of the list it drives; leave it out for a field that only hands its text on. */
  list?: string
  /** The id of the lit row in that list. */
  activeId?: string
  variant?: "bar" | "field"
  class?: HTMLAttributes["class"]
}>(), { variant: "bar" })
const model = defineModel<string>({ default: "" })
defineSlots<{ icon?: () => unknown, trailing?: () => unknown }>()

const input = ref<HTMLInputElement | null>(null)
defineExpose({ input, focus: () => input.value?.focus() })

function onFrameDown(event: MouseEvent) {
  const target = event.target as Element
  if (target === input.value || target.closest("[data-slot=palette-search-trailing]")) return
  event.preventDefault()
  input.value?.focus()
}
</script>

<template>
  <!-- A click on the frame or the icon puts the caret in the field, as a click on the text does. -->
  <div
    data-slot="palette-search"
    :data-variant="variant"
    :class="cn(
      'flex flex-none cursor-text items-center gap-3 px-4 [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground',
      variant === 'bar' ? 'h-14 border-b' : 'bg-card border-input focus-within:border-primary h-14 rounded-xl border px-4.5 transition-colors',
      props.class,
    )"
    @mousedown="onFrameDown"
  >
    <slot name="icon"><Search aria-hidden="true" /></slot>
    <input
      ref="input"
      v-model="model"
      v-bind="$attrs"
      data-slot="palette-search-input"
      :role="list ? 'combobox' : undefined"
      :aria-expanded="list ? 'true' : undefined"
      :aria-controls="list"
      :aria-autocomplete="list ? 'list' : undefined"
      :aria-activedescendant="list ? activeId : undefined"
      autocomplete="off"
      spellcheck="false"
      class="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-base outline-none"
    >
    <span v-if="$slots.trailing" data-slot="palette-search-trailing" class="flex shrink-0 items-center gap-1"><slot name="trailing" /></span>
  </div>
</template>
