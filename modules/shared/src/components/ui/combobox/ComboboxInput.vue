<script setup lang="ts">
import type { ComboboxInputEmits, ComboboxInputProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Search, X } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { ComboboxInput, useForwardPropsEmits } from "reka-ui"
import { onMounted, ref } from "vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { freeKeys } from "./free-keys"

defineOptions({
  inheritAttrs: false,
})

// Looks like the kit's Input, with a search icon in front unless `icon` is false. Once there is text, a button at the
// end clears it and keeps the focus in the field, like the kit's SearchInput (`clearable` false leaves it out, for a field
// whose end holds a ComboboxTrigger).
// `free`: the text is the value and the list only suggests (use it with `ignore-filter` and `:reset-search-term-on-blur="false"` on the
// Combobox). Enter then keeps what is typed and says so with `commit`; only an item reached with the arrow keys is picked.
const props = withDefaults(
  defineProps<ComboboxInputProps & { class?: HTMLAttributes["class"], icon?: boolean, clearable?: boolean, clearLabel?: string, free?: boolean }>(),
  { icon: true, clearable: true, clearLabel: "Clear search" },
)
const emits = defineEmits<ComboboxInputEmits & { commit: [text: string] }>()

const delegatedProps = reactiveOmit(props, "class", "icon", "clearable", "clearLabel", "free")

const forwarded = useForwardPropsEmits(delegatedProps, emits)

const box = ref<HTMLElement | null>(null)
const text = ref("")
const input = () => box.value?.querySelector<HTMLInputElement>("input") ?? null

const keys = freeKeys()
function onKeyCapture(event: KeyboardEvent) {
  if (!props.free) return
  if (keys.press(event) === "commit") {
    event.stopImmediatePropagation()
    event.preventDefault()
    emits("commit", (event.target as HTMLInputElement).value)
  }
}

// reka keeps the text in the field (typing, or the picked item shown after a choice) and reports every change.
function onText(value: string | undefined) {
  text.value = value ?? ""
  keys.reset()
}

// The search text belongs to reka's Combobox, so the clear goes through the field itself: empty it and send the same
// input event typing would, so the list filter (and any v-model) follow.
function clear() {
  const field = input()
  if (!field) return
  field.value = ""
  field.dispatchEvent(new Event("input", { bubbles: true }))
  text.value = ""
  field.focus()
}
</script>

<template>
  <div ref="box" class="relative w-full">
    <Search
      v-if="icon"
      class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      :stroke-width="1.5"
    />
    <ComboboxInput
      data-slot="combobox-input"
      v-bind="{ ...$attrs, ...forwarded }"
      autocomplete="off"
      spellcheck="false"
      :class="cn(
        'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/10 border-input h-8 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
        icon && 'pl-8',
        'pr-9',
        props.class,
      )"
      @keydown.capture="onKeyCapture"
      @blur="keys.reset()"
      @update:model-value="onText"
    />
    <!-- The × turns in with a little spring and leaves quick (motion.css, .tavora-clear-in / -out). -->
    <Transition enter-active-class="tavora-clear-in" leave-active-class="tavora-clear-out">
      <Button
        v-if="clearable && text && !props.disabled"
        size="icon-xs"
        variant="ghost"
        class="absolute top-1/2 right-1.5 -translate-y-1/2"
        :aria-label="clearLabel"
        :title="clearLabel"
        data-slot="combobox-input-clear"
        @mousedown.prevent
        @click="clear"
      >
        <X :stroke-width="1.5" aria-hidden="true" />
      </Button>
    </Transition>
  </div>
</template>
