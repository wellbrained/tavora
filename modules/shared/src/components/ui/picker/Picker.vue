<script setup lang="ts" generic="T extends string">
// One choice from a list: a button showing the current one, and under it the list. With `search`
// set, a field on top narrows the list by label and keywords, and Enter picks the first match.
// Arrow keys, Home and End move through the list, as in any listbox.
import { Check, ChevronsUpDown, Search } from "@lucide/vue"
import type { HTMLAttributes } from "vue"
import { computed, ref, watch } from "vue"
import { ListboxContent, ListboxFilter, ListboxItem, ListboxItemIndicator, ListboxRoot, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import type { PickerOption } from "./types"

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  options: PickerOption<T>[]
  /** What the choice is about, read out for the button and the list. */
  label: string
  /** The search field's placeholder; leave it out for a list without search. */
  search?: string
  /** Shown when the search matches nothing. */
  empty?: string
  /** Test ids for the menu parts: `<testid>-menu`, `-search`, `-option-<value>`, `-none`. */
  testid?: string
  disabled?: boolean
  class?: HTMLAttributes["class"]
}>()
const model = defineModel<T>({ required: true })
const open = defineModel<boolean>("open", { default: false })

const query = ref("")
const current = computed(() => props.options.find((option) => option.value === model.value) ?? props.options[0])
const shown = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!props.search || !text) return props.options
  return props.options.filter((option) => `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(text))
})
const part = (name: string) => (props.testid ? `${props.testid}-${name}` : undefined)

watch(open, (isOpen) => {
  if (isOpen) query.value = ""
})

function pick(value: unknown) {
  if (typeof value !== "string") return
  open.value = false
  if (value !== model.value) model.value = value as T
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        v-bind="$attrs"
        variant="secondary"
        :disabled="disabled"
        :class="cn('max-w-56 min-w-44 justify-between', props.class)"
        :aria-label="label"
        aria-haspopup="listbox"
      >
        <span class="truncate">{{ current?.label }}</span>
        <ChevronsUpDown class="size-4 flex-none" :stroke-width="1.5" />
      </Button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="end"
        :side-offset="6"
        :collision-padding="8"
        class="bg-popover text-popover-foreground z-50 w-64 overflow-hidden rounded-lg border shadow-lg"
        :data-testid="part('menu')"
      >
        <ListboxRoot :model-value="model" highlight-on-hover @update:model-value="pick">
          <div v-if="search" class="relative border-b">
            <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" />
            <ListboxFilter
              v-model="query"
              auto-focus
              class="placeholder:text-muted-foreground h-10 w-full bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none"
              :placeholder="search"
              :aria-label="search"
              autocomplete="off"
              spellcheck="false"
              maxlength="40"
              :data-testid="part('search')"
            />
          </div>
          <ListboxContent class="max-h-60 overflow-y-auto p-1 outline-none" :aria-label="label">
            <ListboxItem
              v-for="option in shown"
              :key="option.value"
              :value="option.value"
              class="data-[highlighted]:bg-accent data-[state=checked]:font-medium flex h-9 w-full cursor-default items-center gap-2 rounded-md px-3 text-left text-sm outline-none select-none"
              :data-testid="part(`option-${option.value}`)"
            >
              <span class="flex-1 truncate">{{ option.label }}</span>
              <ListboxItemIndicator>
                <Check class="text-primary size-4 flex-none" :stroke-width="1.5" />
              </ListboxItemIndicator>
            </ListboxItem>
            <p v-if="!shown.length" class="text-muted-foreground px-3 py-3 text-sm" :data-testid="part('none')">{{ empty }}</p>
          </ListboxContent>
        </ListboxRoot>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
