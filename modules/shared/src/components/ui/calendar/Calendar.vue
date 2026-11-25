<script setup lang="ts">
// One month of days to pick one from, built on reka's Calendar. Days go in and out as "YYYY-MM-DD" strings, months as
// "YYYY-MM", so a module never handles date objects. A day can carry a mark (a tinted cell and a few words read after the
// date); `min`, `max` and `isDisabled` grey out days that can't be picked, and ‹ › stop at the months that hold them.
// Today has a ring; `today` pins it (tests, daily puzzles). Weeks start on Monday unless `weekStartsOn` says otherwise.
// Every pick, also of the day already picked, says so with `pick`; `v-model` holds the picked day.
import { CalendarCell, CalendarCellTrigger, CalendarGrid, CalendarGridBody, CalendarGridHead, CalendarGridRow, CalendarHeadCell, CalendarHeader, CalendarHeading, CalendarNext, CalendarPrev, CalendarRoot, type DateValue } from "reka-ui"
import { ChevronLeft, ChevronRight } from "@lucide/vue"
import { computed, shallowRef, watch, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { uiLocale, uiText } from "../text"
import { dayLabel, firstMonth, localToday, monthOf, monthStart, toCalendarDate, TONE_CLASSES, type CalendarMark } from "./days"

type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

const props = withDefaults(
  defineProps<{
    /** What the calendar is for, read by screen readers ("Earlier puzzles"). */
    label: string
    marks?: Record<string, CalendarMark>
    min?: string
    max?: string
    /** Days that can't be picked besides those outside min and max. */
    isDisabled?: (day: string) => boolean
    /** Today as "YYYY-MM-DD"; this computer's day when left out. */
    today?: string
    /** 0 is Sunday, 1 Monday. */
    weekStartsOn?: WeekStart
    disabled?: boolean
    class?: HTMLAttributes["class"]
  }>(),
  { weekStartsOn: 1 },
)
const model = defineModel<string | undefined>()
const month = defineModel<string>("month")
const emit = defineEmits<{ pick: [day: string] }>()

const todayDay = computed(() => props.today ?? localToday())
const picked = computed(() => toCalendarDate(model.value))
const minValue = computed(() => toCalendarDate(props.min))
const maxValue = computed(() => toCalendarDate(props.max))

const markOf = (day: string): CalendarMark | undefined => props.marks?.[day]
const isDateDisabled = (date: DateValue) => props.isDisabled?.(date.toString()) ?? false
/** A day that can't be picked: the same days reka greys out (`data-disabled`). Days compare as "YYYY-MM-DD" text. */
const isOff = (day: string) => props.disabled || (!!props.min && day < props.min) || (!!props.max && day > props.max) || (props.isDisabled?.(day) ?? false)

// The day the keyboard is on; its month is the month shown. Asking for another month moves it to that month's first
// day. It is kept on a day that can be picked: reka gives a month no tab stop at all when its first day is before `min`
// (its first-focusable search skips the month), so the kit moves it there itself.
const placeholder = shallowRef<DateValue>(settle(firstMonth({ month: month.value, picked: model.value, today: todayDay.value, min: props.min, max: props.max })))
watch(month, (next) => {
  const start = monthStart(next)
  if (start && monthOf(start) !== monthOf(placeholder.value)) placeholder.value = settle(start)
})
function onPlaceholder(next: DateValue) {
  placeholder.value = settle(next)
  const shown = monthOf(next)
  if (month.value !== shown) month.value = shown
}
/** The first day from `date` to the end of its month that can be picked, or `date` when none can. */
function settle(date: DateValue): DateValue {
  for (let day = date; day.month === date.month; day = day.add({ days: 1 })) if (!isOff(day.toString())) return day
  return date
}

function onModel(next: DateValue | undefined) {
  if (next) model.value = next.toString()
}
/** A click or Enter/Space on a day. */
function choose(day: string, event: MouseEvent | KeyboardEvent) {
  if (event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey || event.altKey)) return
  if (!isOff(day)) emit("pick", day)
}

/**
 * One look per day, so nothing depends on which class Tailwind writes last: a day that can't be picked is greyed (its
 * mark too), the picked day is filled with primary (over its mark), a marked day has its tone, any other day a plain
 * hover. Today adds its ring and a bolder number to whichever it is.
 */
function dayClass(day: string): string {
  const today = day === todayDay.value && "font-semibold ring-2 ring-inset ring-ring"
  if (isOff(day)) return cn("text-muted-foreground cursor-default opacity-45", today)
  if (day === model.value) return cn("bg-primary text-primary-foreground hover:bg-primary-hover font-semibold", today)
  const mark = markOf(day)
  return cn(mark ? TONE_CLASSES[mark.tone].day : "hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))]", today)
}

</script>

<template>
  <CalendarRoot
    v-slot="{ grid, weekDays }"
    data-slot="calendar"
    :model-value="picked"
    :placeholder="placeholder"
    :min-value="minValue"
    :max-value="maxValue"
    :is-date-disabled="isDateDisabled"
    :week-starts-on="weekStartsOn"
    :locale="uiLocale"
    :calendar-label="label"
    :disabled="disabled"
    weekday-format="narrow"
    prevent-deselect
    :class="cn('flex w-full flex-col gap-2', props.class)"
    @update:model-value="onModel"
    @update:placeholder="onPlaceholder"
  >
    <CalendarHeader data-slot="calendar-header" class="flex items-center justify-between gap-2">
      <CalendarPrev as-child>
        <Button variant="ghost" size="icon-sm" class="text-muted-foreground" :aria-label="uiText.previousMonth"><ChevronLeft /></Button>
      </CalendarPrev>
      <CalendarHeading data-slot="calendar-heading" class="text-sm font-semibold" aria-live="polite" />
      <CalendarNext as-child>
        <Button variant="ghost" size="icon-sm" class="text-muted-foreground" :aria-label="uiText.nextMonth"><ChevronRight /></Button>
      </CalendarNext>
    </CalendarHeader>
    <CalendarGrid v-for="shown in grid" :key="shown.value.toString()" data-slot="calendar-grid" class="w-full border-collapse select-none">
      <CalendarGridHead>
        <CalendarGridRow class="grid grid-cols-7 gap-1">
          <CalendarHeadCell v-for="(day, i) in weekDays" :key="i" class="text-muted-foreground text-center text-xs font-normal">{{ day }}</CalendarHeadCell>
        </CalendarGridRow>
      </CalendarGridHead>
      <CalendarGridBody class="mt-1 grid gap-1">
        <CalendarGridRow v-for="(week, w) in shown.rows" :key="w" class="grid grid-cols-7 gap-1">
          <CalendarCell v-for="date in week" :key="date.toString()" :date="date" class="relative p-0">
            <CalendarCellTrigger
              v-slot="cell"
              :day="date"
              :month="shown.value"
              data-slot="calendar-day"
              :data-tone="markOf(date.toString())?.tone"
              :data-today="date.toString() === todayDay ? '' : undefined"
              :aria-current="date.toString() === todayDay ? 'date' : undefined"
              :aria-label="dayLabel(date.toString(), uiLocale, markOf(date.toString()))"
              :class="cn('relative grid aspect-square w-full cursor-pointer place-items-center rounded-sm text-sm tabular-nums outline-none focus-visible:ring-ring/50 focus-visible:ring-3 data-outside-view:invisible', dayClass(date.toString()))"
              @click="choose(date.toString(), $event)"
              @keydown.enter="choose(date.toString(), $event)"
              @keydown.space="choose(date.toString(), $event)"
            >
              <slot name="day" :day="date.toString()" :number="date.day" :mark="markOf(date.toString())" :today="date.toString() === todayDay" :selected="cell.selected" :disabled="cell.disabled">
                {{ cell.dayValue }}
              </slot>
            </CalendarCellTrigger>
          </CalendarCell>
        </CalendarGridRow>
      </CalendarGridBody>
    </CalendarGrid>
  </CalendarRoot>
</template>
