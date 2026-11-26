<script setup lang="ts" generic="T extends string">
// A list that is always open, to take one thing from: an "Add …" dialog, a page that starts with a choice. With
// `search`, a field on top narrows it as you type and keeps the focus (typing anywhere on the page lands there); the
// arrow keys, Home, End and the page keys move the lit row, Enter or a click takes it (`pick`). A new search lights the
// top match. Options with a `group` are listed under its heading; a `disabled` option stays in the list, dimmed, with
// its reason at the end. The list fills the height it is given and scrolls inside it (or up to `maxHeight`).
// The kit narrows by label and keywords and bolds what matched; with `:filter="false"` the page narrows and ranks the
// options itself from `v-model:query`. `v-model` is optional: it marks the chosen row.
// Slots, all optional: `option` (a row's content), `group` (a heading) and `empty` (when nothing is left).
import { Search } from "@lucide/vue"
import { computed, nextTick, ref, useId, useTemplateRef, watch, type HTMLAttributes } from "vue"
import { isComposing } from "../../../lib/keys"
import { cn } from "../../../lib/utils"
import { choiceHighlighted, choiceRow } from "../choice-row"
import { EmptyState } from "../empty-state"
import { SearchInput } from "../search-input"
import { uiText } from "../text"
import { useKeepFocus } from "./keep-focus"
import { filterOptions, sectionsOf } from "../picker/options"
import { matchParts, moveFor, moveIndex, type LabelPart } from "./listbox"
import type { ListboxOption } from "./types"

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  options: ListboxOption<T>[]
  /** What the list is about, read out for the list and the search field. */
  label: string
  /** The search field's placeholder; leave it out for a list without search. */
  search?: string
  /** Shown when nothing is left to list; "No matches" in the user's language by default. */
  empty?: string
  /** Whether the kit narrows the list by the search. Off: pass the options the page found for `v-model:query`. */
  filter?: boolean
  /** Keeps the focus in the search field while the list is shown (on by default with `search`). */
  autofocus?: boolean
  /** A height the list scrolls at ("16rem"), for a list that isn't in a column that sizes it. */
  maxHeight?: string
  /** Test ids for the parts: `<testid>-search`, `-list`, `-option-<value>`, `-none`. */
  testid?: string
  class?: HTMLAttributes["class"]
}>(), { filter: true, autofocus: true })
const emit = defineEmits<{ pick: [value: T] }>()
const model = defineModel<T>()
const query = defineModel<string>("query", { default: "" })
defineSlots<{
  option?: (props: { option: ListboxOption<T>, parts: LabelPart[], active: boolean }) => unknown
  group?: (props: { group: string }) => unknown
  empty?: () => unknown
}>()

const id = useId()
const listId = `${id}-list`
const rowId = (index: number) => `${id}-option-${index}`
const list = useTemplateRef<HTMLElement>("list")
const field = useTemplateRef<InstanceType<typeof SearchInput>>("field")
const fieldInput = () => (field.value?.$el as HTMLElement | undefined)?.querySelector("input")
const part = (name: string) => (props.testid ? `${props.testid}-${name}` : undefined)

const shown = computed(() => (props.filter ? filterOptions(props.options, query.value) : props.options))
const sections = computed(() => sectionsOf(shown.value))
/** The rows in the order they are shown (groups move rows), for the arrow keys. */
const rows = computed(() => sections.value.flatMap((section) => section.options))
const indexOf = computed(() => new Map(rows.value.map((option, index) => [option.value, index])))
const bold = (option: ListboxOption<T>) => (props.filter ? matchParts(option.label, query.value) : [{ text: option.label, match: false }])

/** The lit row's value: the chosen one to begin with, else the top one that can be picked. */
const active = ref<T | undefined>()
const activeIndex = computed(() => (active.value === undefined ? -1 : (indexOf.value.get(active.value) ?? -1)))
const activeId = computed(() => (activeIndex.value >= 0 ? rowId(activeIndex.value) : undefined))

function highlightTop(): void {
  const chosen = rows.value.find((option) => option.value === model.value && !option.disabled)
  const at = chosen && !query.value ? indexOf.value.get(chosen.value) : moveIndex(rows.value, -1, "first")
  active.value = at === undefined ? undefined : rows.value[at]!.value
}
highlightTop()
// A new search starts at its top match, scrolled to the top.
// With the page's own search, its new options come one render later: light the top again once they are in.
watch(query, async () => {
  highlightTop()
  if (list.value) list.value.scrollTop = 0
  await nextTick()
  highlightTop()
})
// New options (the page's own search, a change in what is used) keep the lit row while it is still there to pick.
watch(rows, () => {
  const still = rows.value.find((option) => option.value === active.value)
  if (!still || still.disabled) highlightTop()
})

/** How many rows a page key steps: the rows that fit the list's height. */
function pageSize(): number {
  const row = list.value?.querySelector<HTMLElement>("[role=option]")
  const height = row?.offsetHeight ?? 0
  return height > 0 ? Math.max(1, Math.floor(list.value!.clientHeight / height) - 1) : 10
}

async function highlight(index: number | undefined): Promise<void> {
  if (index === undefined) return
  active.value = rows.value[index]!.value
  await nextTick()
  list.value?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView({ block: "nearest" })
}

function pick(option: ListboxOption<T> | undefined): void {
  if (!option || option.disabled) return
  if (model.value !== option.value) model.value = option.value
  emit("pick", option.value)
}

function onKeydown(event: KeyboardEvent): void {
  if (isComposing(event)) return
  const move = moveFor(event.key)
  if (move) void highlight(moveIndex(rows.value, activeIndex.value, move, pageSize()))
  else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) pick(rows.value[activeIndex.value])
  else return
  event.preventDefault()
}

function hover(option: ListboxOption<T>): void {
  if (!option.disabled && active.value !== option.value) active.value = option.value
}

useKeepFocus(fieldInput, () => !!props.search && props.autofocus)
</script>

<template>
  <div v-bind="$attrs" data-slot="listbox" :class="cn('flex min-h-0 flex-col gap-3', props.class)">
    <SearchInput
      v-if="search"
      ref="field"
      v-model="query"
      :placeholder="search"
      :aria-label="label"
      role="combobox"
      aria-expanded="true"
      aria-autocomplete="list"
      :aria-controls="listId"
      :aria-activedescendant="activeId"
      autocomplete="off"
      spellcheck="false"
      :data-testid="part('search')"
      @keydown="onKeydown"
    />
    <div
      :id="listId"
      ref="list"
      role="listbox"
      :aria-label="label"
      :tabindex="search ? -1 : 0"
      :aria-activedescendant="search ? undefined : activeId"
      :class="cn('focus-visible:ring-ring/50 -mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md px-1 outline-none focus-visible:ring-[3px]', !shown.length && 'hidden')"
      :style="maxHeight ? { maxHeight } : undefined"
      :data-testid="part('list')"
      @keydown="search ? undefined : onKeydown($event)"
    >
      <template v-for="(section, at) in sections" :key="section.group">
        <div
          :role="section.group ? 'group' : undefined"
          :aria-labelledby="section.group ? `${id}-group-${at}` : undefined"
          class="not-first:mt-1 not-first:border-t not-first:pt-1"
        >
          <div v-if="section.group" :id="`${id}-group-${at}`" data-slot="listbox-group" class="text-muted-foreground flex h-7 items-center gap-2 px-3 text-xs font-medium">
            <slot name="group" :group="section.group">{{ section.group }}</slot>
          </div>
          <div
            v-for="option in section.options"
            :id="rowId(indexOf.get(option.value)!)"
            :key="option.value"
            role="option"
            data-slot="listbox-item"
            :aria-selected="option.value === active"
            :aria-checked="model === undefined ? undefined : option.value === model"
            :aria-disabled="option.disabled ? true : undefined"
            :data-highlighted="option.value === active ? '' : undefined"
            :data-disabled="option.disabled ? '' : undefined"
            :data-state="option.value === model ? 'checked' : undefined"
            :data-testid="part(`option-${option.value}`)"
            :class="cn('data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex min-h-[var(--style-control-height,32px)] w-full cursor-default items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm select-none data-[disabled]:opacity-(--disabled-opacity)', choiceRow, choiceHighlighted)"
            @pointermove="hover(option)"
            @mousedown.prevent="search || list?.focus({ preventScroll: true })"
            @click="pick(option)"
          >
            <slot name="option" :option="option" :parts="bold(option)" :active="option.value === active">
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate"><template v-for="(piece, n) in bold(option)" :key="n"><b v-if="piece.match" class="font-semibold">{{ piece.text }}</b><template v-else>{{ piece.text }}</template></template></span>
                <span v-if="option.description" class="text-muted-foreground truncate text-xs">{{ option.description }}</span>
              </span>
              <span v-if="typeof option.disabled === 'string' || option.meta" class="text-muted-foreground flex-none text-xs tabular-nums">
                {{ typeof option.disabled === "string" ? option.disabled : option.meta }}
              </span>
            </slot>
          </div>
        </div>
      </template>
    </div>
    <!-- Always there, so a screen reader hears it when the search leaves nothing. -->
    <div role="status" :class="shown.length ? 'sr-only' : 'min-h-0 flex-1'">
      <div v-if="!shown.length" :data-testid="part('none')">
        <slot name="empty">
          <EmptyState :title="empty ?? uiText.noMatches" class="py-6">
            <template #icon><Search /></template>
          </EmptyState>
        </slot>
      </div>
    </div>
  </div>
</template>
