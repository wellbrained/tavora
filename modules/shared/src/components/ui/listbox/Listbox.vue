<script setup lang="ts" generic="T extends string">
// A list that is always open, to take one thing from: an "Add …" dialog, a page that starts with a choice. With
// `search`, a field on top narrows it as you type and keeps the focus (typing anywhere on the page lands there); the
// arrow keys, Home, End and the page keys move the lit row, Enter or a click takes it (`pick`). A new search lights the
// top match. Options with a `group` are listed under its heading; a `disabled` option stays in the list, dimmed, with
// its reason at the end. The list fills the height it is given and scrolls inside it (or up to `maxHeight`).
// The kit narrows by label and keywords and bolds what matched; with `:filter="false"` the page narrows and ranks the
// options itself from `v-model:query`. `v-model` is optional: it marks the chosen row.
// `size="lg"` is the palette look (an "Add a recipe" picker in a dialog): the big frameless search with a line under it,
// taller rows with bigger icons, a line between groups, and with `hints` the keys in a foot. Rows are PaletteItems, as
// in the app's own palettes; an option's `icon` goes in front, `busy` shows a spinner while its pick is being done.
// Slots, all optional: `option` (a row's label: it sits where the label goes, the second line and end text are left
// out when it is used), `leading` (a picture in front of a row), `group` (a heading) and
// `empty` (when nothing is left).
import { Search } from "@lucide/vue"
import { computed, nextTick, ref, useId, useTemplateRef, watch, type HTMLAttributes } from "vue"
import { isComposing } from "../../../lib/keys"
import { cn } from "../../../lib/utils"
import { EmptyState } from "../empty-state"
import { PaletteFooter, PaletteGroup, PaletteItem, PaletteSearch, type PaletteHint } from "../palette"
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
  /** `lg`: the palette look, for a list that is the whole of a dialog. */
  size?: "default" | "lg"
  /**
   * The keys, in a foot under the list (`size="lg"`): `true` for ↑ ↓ to move and Enter to pick, or your own (add
   * "Esc to close" in a dialog).
   */
  hints?: boolean | PaletteHint[]
  /** Test ids for the parts: `<testid>-search`, `-list`, `-option-<value>`, `-none`. */
  testid?: string
  class?: HTMLAttributes["class"]
}>(), { filter: true, autofocus: true, size: "default", hints: false })
const emit = defineEmits<{ pick: [value: T] }>()
const model = defineModel<T>()
const query = defineModel<string>("query", { default: "" })
defineSlots<{
  option?: (props: { option: ListboxOption<T>, parts: LabelPart[], active: boolean }) => unknown
  leading?: (props: { option: ListboxOption<T> }) => unknown
  group?: (props: { group: string }) => unknown
  empty?: () => unknown
}>()

const id = useId()
const listId = `${id}-list`
const rowId = (index: number) => `${id}-option-${index}`
const list = useTemplateRef<HTMLElement>("list")
const field = useTemplateRef<InstanceType<typeof SearchInput>>("field")
const bigField = useTemplateRef<InstanceType<typeof PaletteSearch>>("bigField")
const fieldInput = () => bigField.value?.input ?? (field.value?.$el as HTMLElement | undefined)?.querySelector("input")
const big = computed(() => props.size === "lg")
const footHints = computed<PaletteHint[]>(() =>
  props.hints === true ? [{ keys: ["↑", "↓"], label: uiText.value.paletteMove }, { keys: [uiText.value.enterKey], label: uiText.value.palettePick }] : props.hints || [],
)
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
  if (!option || option.disabled || option.busy) return
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
  <div v-bind="$attrs" data-slot="listbox" :data-size="size" :class="cn('flex min-h-0 flex-col', big ? 'gap-0' : 'gap-3', props.class)">
    <PaletteSearch
      v-if="search && big"
      ref="bigField"
      v-model="query"
      :list="listId"
      :active-id="activeId"
      :placeholder="search"
      :aria-label="label"
      :data-testid="part('search')"
      @keydown="onKeydown"
    />
    <SearchInput
      v-else-if="search"
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
      :class="cn('focus-visible:ring-ring/50 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md outline-none focus-visible:ring-[3px]', big ? 'p-2' : '-mx-1 px-1', !shown.length && 'hidden')"
      :style="maxHeight ? { maxHeight } : undefined"
      :data-testid="part('list')"
      @keydown="search ? undefined : onKeydown($event)"
    >
      <PaletteGroup v-for="section in sections" :key="section.group" :label="section.group || undefined">
        <template v-if="section.group && $slots.group" #label><slot name="group" :group="section.group" /></template>
        <PaletteItem
          v-for="option in section.options"
          :id="rowId(indexOf.get(option.value)!)"
          :key="option.value"
          data-slot="listbox-item"
          :size="size"
          :icon="option.icon"
          :active="option.value === active"
          :busy="option.busy"
          :label="option.label"
          :match="filter ? query : ''"
          :disabled="!!option.disabled"
          :chosen="model === undefined ? undefined : option.value === model"
          :data-testid="part(`option-${option.value}`)"
          @pointermove="hover(option)"
          @mousedown.prevent="search || list?.focus({ preventScroll: true })"
          @click="pick(option)"
        >
          <template v-if="$slots.leading" #leading><slot name="leading" :option="option" /></template>
          <template v-if="$slots.option" #default><slot name="option" :option="option" :parts="bold(option)" :active="option.value === active" /></template>
          <template v-if="!$slots.option && option.description" #description>{{ option.description }}</template>
          <template v-if="!$slots.option && (typeof option.disabled === 'string' || option.meta)" #trailing>
            <span class="tabular-nums">{{ typeof option.disabled === "string" ? option.disabled : option.meta }}</span>
          </template>
        </PaletteItem>
      </PaletteGroup>
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
    <PaletteFooter v-if="big && footHints.length" :hints="footHints" />
  </div>
</template>
