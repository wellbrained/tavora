<script setup lang="ts" generic="T extends string">
// One choice from a list: a button showing the current one, and under it the list. With `search`
// set, a field on top narrows the list by label and keywords, and Enter picks the first match.
// Arrow keys, Home and End move through the list, as in any listbox.
// Options with a `group` are listed under its heading. Slots, all optional: `current` (what the button shows; then the
// button is sized by its class, not by the longest choice), `option` (a row, e.g. with badges at its end), `group` (a
// heading, e.g. with an icon) and `filters` (above the list, under the search: toggles that narrow `options`).
import { Check, ChevronsUpDown, Search } from "@lucide/vue"
import type { HTMLAttributes } from "vue"
import { computed, ref, watch } from "vue"
import { ListboxContent, ListboxFilter, ListboxGroup, ListboxGroupLabel, ListboxItem, ListboxItemIndicator, ListboxRoot, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui"
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
const slots = defineSlots<{
  current?: (props: { option: PickerOption<T> | undefined }) => unknown
  option?: (props: { option: PickerOption<T> }) => unknown
  group?: (props: { group: string }) => unknown
  filters?: () => unknown
}>()
const open = defineModel<boolean>("open", { default: false })

const query = ref("")
const current = computed(() => props.options.find((option) => option.value === model.value) ?? (slots.current ? undefined : props.options[0]))
const shown = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!props.search || !text) return props.options
  return props.options.filter((option) => `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(text))
})
/** The shown options by group, in the order each group's first option comes; ungrouped ones first. */
const sections = computed(() => {
  const groups = new Map<string, PickerOption<T>[]>()
  const loose = shown.value.filter((option) => !option.group)
  for (const option of shown.value) if (option.group) groups.set(option.group, [...(groups.get(option.group) ?? []), option])
  return [...(loose.length ? [{ group: "", options: loose }] : []), ...[...groups].map(([group, options]) => ({ group, options }))]
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
        press="dip"
        :disabled="disabled"
        :class="cn('max-w-56 min-w-44 justify-between', props.class)"
        :aria-label="label"
        aria-haspopup="listbox"
      >
        <span v-if="slots.current" class="flex min-w-0 flex-1 items-center gap-2 text-left"><slot name="current" :option="current" /></span>
        <!-- Every label sits in the same grid cell, hidden but for the current one, so the button is as wide as the longest
             choice (up to max-w-56) and keeps that size whichever is picked. -->
        <span v-else class="grid min-w-0 text-left">
          <span v-for="option in options" :key="option.value" class="invisible col-start-1 row-start-1 truncate" aria-hidden="true">{{ option.label }}</span>
          <span class="col-start-1 row-start-1 truncate">{{ current?.label }}</span>
        </span>
        <ChevronsUpDown class="size-4 flex-none" :stroke-width="1.5" />
      </Button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="start"
        :side-offset="6"
        :collision-padding="8"
        :class="cn('bg-popover text-popover-foreground tavora-popup z-50 w-max max-w-80 min-w-(--reka-popover-trigger-width) overflow-hidden rounded-lg border shadow-lg', search && 'min-w-[max(16rem,var(--reka-popover-trigger-width))]')"
        :data-testid="part('menu')"
      >
        <ListboxRoot :model-value="model" highlight-on-hover @update:model-value="pick">
          <div v-if="search" class="relative w-full border-b">
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
          <div v-if="slots.filters" class="border-b px-2 py-2" :data-testid="part('filters')"><slot name="filters" /></div>
          <ListboxContent class="max-h-60 overflow-y-auto p-1 outline-none" :aria-label="label">
            <ListboxGroup v-for="section in sections" :key="section.group" class="not-first:mt-1 not-first:border-t not-first:pt-1">
              <ListboxGroupLabel v-if="section.group" data-slot="picker-group" class="text-muted-foreground flex h-7 items-center gap-2 px-3 text-xs font-medium">
                <slot name="group" :group="section.group">{{ section.group }}</slot>
              </ListboxGroupLabel>
              <ListboxItem
                v-for="option in section.options"
                :key="option.value"
                :value="option.value"
                class="data-[highlighted]:bg-accent data-[state=checked]:font-medium flex h-9 w-full cursor-default items-center gap-2 rounded-md px-3 text-left text-sm outline-none select-none"
                :data-testid="part(`option-${option.value}`)"
              >
                <slot name="option" :option="option"><span class="flex-1 truncate">{{ option.label }}</span></slot>
                <ListboxItemIndicator>
                  <Check class="text-primary size-4 flex-none" :stroke-width="1.5" />
                </ListboxItemIndicator>
              </ListboxItem>
            </ListboxGroup>
            <p v-if="!shown.length" class="text-muted-foreground px-3 py-3 text-sm" :data-testid="part('none')">{{ empty }}</p>
          </ListboxContent>
        </ListboxRoot>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
