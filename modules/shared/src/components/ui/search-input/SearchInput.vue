<script setup lang="ts">
// A search field: a magnifier at the start and, once there is text, a button at the end that clears it and keeps the
// focus in the field. Escape clears too while there is text; on an empty field it is left to what is around it.
// Attributes (placeholder, aria-label, data-testid) go to the input; `class` sizes the whole field.
import { Search, X } from "@lucide/vue"
import { ref, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { Input } from "../input"
import { clearsOnEscape } from "./escape"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  /** The clear button has no text; modules pass a translated name. */
  clearLabel?: string
  disabled?: boolean
  class?: HTMLAttributes["class"]
}>(), { clearLabel: "Clear search" })
const model = defineModel<string>({ default: "" })

const field = ref<InstanceType<typeof Input> | null>(null)

function clear() {
  model.value = ""
  ;(field.value?.$el as HTMLInputElement | undefined)?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !clearsOnEscape(model.value)) return
  event.preventDefault()
  event.stopPropagation()
  model.value = ""
}
</script>

<template>
  <div data-slot="search-input" :class="cn('relative flex min-w-0 items-center', props.class)">
    <Search class="text-muted-foreground pointer-events-none absolute left-3 size-4" :stroke-width="1.5" aria-hidden="true" />
    <Input
      ref="field"
      v-bind="$attrs"
      v-model="model"
      type="search"
      :disabled="disabled"
      class="pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
      @keydown="onKeydown"
    />
    <Button
      v-if="model && !disabled"
      size="icon-xs"
      variant="ghost"
      class="absolute right-2"
      :aria-label="clearLabel"
      :title="clearLabel"
      data-slot="search-input-clear"
      @click="clear"
    >
      <X :stroke-width="1.5" aria-hidden="true" />
    </Button>
  </div>
</template>
