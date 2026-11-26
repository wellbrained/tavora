<script setup lang="ts">
// A search field: a magnifier at the start and, once there is text, a button at the end that clears it and keeps the
// focus in the field. Escape clears too while there is text; on an empty field it is left to what is around it.
// Attributes (placeholder, aria-label, data-testid) go to the input; `class` sizes the whole field.
import { Search, X } from "@lucide/vue"
import { ref, type HTMLAttributes } from "vue"
import { isComposing } from "../../../lib/keys"
import type { ControlSize } from "../../../lib/control-size"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { leaveToolbar } from "../toolbar/context"
import { Input } from "../input"
import { uiText } from "../text"
import { clearsOnEscape } from "./escape"
// Its buttons are parts of it, not stops of a Toolbar around it.
leaveToolbar()

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  /** The clear button's name for screen readers; it says "Clear search" in the user's language by default. */
  clearLabel?: string
  disabled?: boolean
  /** The kit's size scale. */
  size?: ControlSize
  class?: HTMLAttributes["class"]
}>(), {})
const model = defineModel<string>({ default: "" })

const field = ref<InstanceType<typeof Input> | null>(null)

function clear() {
  model.value = ""
  ;(field.value?.$el as HTMLInputElement | undefined)?.focus()
}

function onKeydown(event: KeyboardEvent) {
  // Escape while an input method composes cancels the composition; the typed text stays.
  if (event.key !== "Escape" || isComposing(event) || !clearsOnEscape(model.value)) return
  event.preventDefault()
  event.stopPropagation()
  model.value = ""
}
</script>

<template>
  <div data-slot="search-input" :class="cn('relative flex min-w-0 items-center', props.class)">
    <Search class="text-muted-foreground pointer-events-none absolute left-3 size-4" aria-hidden="true" />
    <Input
      ref="field"
      v-bind="$attrs"
      v-model="model"
      type="search"
      :size="size"
      :disabled="disabled"
      class="pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
      @keydown="onKeydown"
    />
    <!-- The × turns in with a little spring and leaves quick (motion.css, .tavora-clear-in / -out). -->
    <Transition enter-active-class="tavora-clear-in" leave-active-class="tavora-clear-out">
      <Button
        v-if="model && !disabled"
        type="button"
        size="icon-xs"
        variant="ghost"
        class="absolute right-2"
        :aria-label="clearLabel ?? uiText.clearSearch"
        :title="clearLabel ?? uiText.clearSearch"
        data-slot="search-input-clear"
        @click="clear"
      >
        <X aria-hidden="true" />
      </Button>
    </Transition>
  </div>
</template>
