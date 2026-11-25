<script setup lang="ts" generic="T extends string">
// One choice from a list: a button showing the current one, and under it the list. With `search`
// set, a field on top narrows the list by label and keywords, and Enter picks the first match.
// Arrow keys, Home and End move through the list, as in any listbox.
// Options with a `group` are listed under its heading. Slots, all optional: `current` (what the button shows; then the
// button is sized by its class, not by the longest choice; its `option` is undefined while the value isn't in
// `options`), `option` (a row, e.g. with badges at its end), `group` (a heading, e.g. with an icon) and `filters` (above
// the list, under the search: toggles that narrow `options`). Use `filters` with `search` (the field keeps the focus)
// and with `current` (a filter may hide the picked option, and the button still shows it).
import { ChevronsUpDown, Search } from "@lucide/vue"
import type { HTMLAttributes } from "vue"
import { createReusableTemplate } from "@vueuse/core"
import { computed, ref, watch } from "vue"
import { ListboxContent, ListboxFilter, ListboxGroup, ListboxGroupLabel, ListboxItem, ListboxRoot, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { leaveToolbar } from "../toolbar/context"
import { choiceHighlighted, choiceRow } from "../choice-row"
import { filterOptions, sectionsOf } from "./options"
import type { PickerOption } from "./types"
// Its buttons are parts of it, not stops of a Toolbar around it.
leaveToolbar()

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  options: PickerOption<T>[]
  /** What the choice is about, read out for the button and the list. */
  label: string
  /** The search field's placeholder; leave it out for a list without search. */
  search?: string
  /** Shown when the search matches nothing. */
  empty?: string
  /** Test ids for the menu parts: `<testid>-menu`, `-search`, `-filters`, `-option-<value>`, `-none`. */
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

/** One row of the list, the same with a group around it or without. */
const [DefineRow, Row] = createReusableTemplate<{ option: PickerOption<T> }>()
const rowClass = cn("data-[highlighted]:bg-accent flex h-9 w-full cursor-default items-center gap-2 rounded-sm px-3 text-left text-sm outline-none select-none", choiceRow, choiceHighlighted)
const query = ref("")
const current = computed(() => props.options.find((option) => option.value === model.value) ?? (slots.current || slots.filters ? undefined : props.options[0]))
const shown = computed(() => (props.search ? filterOptions(props.options, query.value) : props.options))
/** The shown options by group, in the order each group's first option comes; ungrouped ones first. */
const sections = computed(() => sectionsOf(shown.value))
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
        <ChevronsUpDown class="size-4 flex-none" data-icon="end" />
      </Button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="start"
        :side-offset="6"
        :collision-padding="8"
        :class="cn('bg-popover text-popover-foreground tavora-popup z-(--layer-floating) w-max max-w-[min(20rem,var(--reka-popover-content-available-width))] min-w-[min(var(--reka-popover-trigger-width),var(--reka-popover-content-available-width))] overflow-hidden rounded-lg border shadow-elevation-3', search && 'min-w-[min(max(16rem,var(--reka-popover-trigger-width)),var(--reka-popover-content-available-width))]')"
        :data-testid="part('menu')"
      >
        <ListboxRoot :model-value="model" highlight-on-hover @update:model-value="pick">
          <div v-if="search" class="focus-within:border-ring relative w-full border-b transition-colors">
            <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <ListboxFilter
              v-model="query"
              auto-focus
              class="placeholder:text-muted-foreground h-10 w-full bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none"
              :placeholder="search"
              :aria-label="search"
              autocomplete="off"
              spellcheck="false"
              :data-testid="part('search')"
            />
          </div>
          <div v-if="slots.filters" class="border-b px-2 py-2" :data-testid="part('filters')"><slot name="filters" /></div>
          <ListboxContent class="max-h-60 overflow-y-auto overscroll-contain p-1 outline-none" :aria-label="label">
            <DefineRow v-slot="{ option }">
              <ListboxItem
                :value="option.value"
                :class="rowClass"
                :data-testid="part(`option-${option.value}`)"
              >
                <slot name="option" :option="option"><span class="flex-1 truncate">{{ option.label }}</span></slot>
              </ListboxItem>
            </DefineRow>
            <!-- Options without a group sit right in the list, as in a Picker without groups. -->
            <template v-for="section in sections" :key="section.group">
              <template v-if="!section.group"><Row v-for="option in section.options" :key="option.value" :option="option" /></template>
              <ListboxGroup v-else class="not-first:mt-1 not-first:border-t not-first:pt-1">
                <ListboxGroupLabel data-slot="picker-group" class="text-muted-foreground flex h-7 items-center gap-2 px-3 text-xs font-medium">
                  <slot name="group" :group="section.group">{{ section.group }}</slot>
                </ListboxGroupLabel>
                <Row v-for="option in section.options" :key="option.value" :option="option" />
              </ListboxGroup>
            </template>
            <p v-if="!shown.length && empty" role="status" class="text-muted-foreground px-3 py-3 text-sm" :data-testid="part('none')">{{ empty }}</p>
          </ListboxContent>
        </ListboxRoot>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
