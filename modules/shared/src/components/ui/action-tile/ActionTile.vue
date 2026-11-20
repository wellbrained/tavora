<script setup lang="ts">
// A square tile that does one thing, such as adding a module: a picture, a short name under it and a small + in the
// corner. Like a ProgressButton it can be the progress of what it started (`status`), and `featured` gives it the
// accent edge (the one meant most for where the user is). `kind: "more"` is the dashed tile at the end of a row that
// opens the rest ("+3 more"). Put several in a `flex flex-wrap` row; each keeps its size.
import type { HTMLAttributes } from "vue"
import { Check, Plus } from "@lucide/vue"
import { computed, ref, watch } from "vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { formatCount } from "../count-to"
import { announcement, type ProgressButtonStatus } from "../progress-button"
import "../progress-button/progress-button.css"

defineOptions({ inheritAttrs: false })

interface Props {
  /** The name under the picture; two lines at most. */
  label: string
  /** `add` (default): a picture, the name and a +. `more`: dashed, just the name, for "+3 more" or "All modules". */
  kind?: "add" | "more"
  /** The accent edge, for the tile meant most for here. */
  featured?: boolean
  /** Idle: the tile as usual. Busy: it shows the progress. Done: a tick and `doneLabel`. As on a ProgressButton. */
  status?: ProgressButtonStatus
  /** While busy: 0 to 100, or null when it can't be known (a stripe moves instead). */
  progress?: number | null
  /** Shown while busy without a percent ("Installing…"). Needed when `status` can be busy. */
  busyLabel?: string
  /** Shown with the tick when done ("Added"). */
  doneLabel?: string
  /** Told to a screen reader when busy ended without working; the error itself is the caller's to show. */
  failedLabel?: string
  disabled?: boolean
  /** Why it is off, in a tooltip beside it. */
  disabledReason?: string
  class?: HTMLAttributes["class"]
}

const props = withDefaults(defineProps<Props>(), { kind: "add", featured: false, status: "idle", progress: null, disabled: false })

const percent = computed(() => (props.progress === null ? null : Math.min(100, Math.max(0, props.progress))))
const locale = () => (typeof document === "undefined" ? undefined : document.documentElement.lang || undefined)
const shownLabel = computed(() => {
  if (props.status === "busy") return percent.value === null ? (props.busyLabel ?? props.label) : formatCount(percent.value / 100, "percent", locale())
  if (props.status === "done") return props.doneLabel ?? props.label
  return props.label
})

/** Heard by a screen reader once per change of status, as on a ProgressButton. */
const said = ref("")
watch(
  () => props.status,
  (now, before) => {
    said.value = announcement(before, now, { busy: props.busyLabel ?? "", done: props.doneLabel ?? "", failed: props.failedLabel })
  },
)

/** While it works or has worked, a click does nothing; it is not disabled, so it keeps its colours. */
function block(event: Event) {
  if (props.status === "idle") return
  event.preventDefault()
  event.stopImmediatePropagation()
}
</script>

<template>
  <Button
    v-bind="$attrs"
    data-slot="action-tile"
    :data-kind="kind"
    :data-status="status"
    variant="outline"
    :disabled="disabled"
    :disabled-reason="disabledReason"
    :aria-busy="status === 'busy' ? 'true' : undefined"
    :class="
      cn(
        'relative size-23 flex-none flex-col gap-1.5 overflow-hidden rounded-lg p-1.5 text-xs font-medium whitespace-normal',
        kind === 'add' ? 'bg-card' : 'text-muted-foreground border-dashed bg-transparent',
        featured && 'border-primary/45',
        props.class,
      )
    "
    @click.capture="block"
  >
    <span v-if="status === 'busy'" class="pointer-events-none absolute inset-x-0 bottom-0 h-1" aria-hidden="true">
      <span
        v-if="percent !== null"
        class="bg-primary absolute inset-0 origin-left transition-transform duration-(--duration-move) ease-(--ease-out-strong)"
        :style="{ transform: `scaleX(${percent / 100})` }"
      />
      <span v-else class="tavora-progress-stripe bg-primary absolute inset-y-0 left-0 w-2/5" />
    </span>
    <Plus v-if="kind === 'add' && status === 'idle'" class="text-muted-foreground absolute top-1.5 right-1.5 size-3!" aria-hidden="true" />
    <span v-if="kind === 'add'" class="grid size-9 flex-none place-items-center [&_img]:size-9 [&_svg]:size-6!" aria-hidden="true">
      <Check v-if="status === 'done'" class="text-primary tavora-progress-pop" />
      <slot v-else name="icon" />
    </span>
    <span class="line-clamp-2 w-full text-center leading-tight tabular-nums">{{ shownLabel }}</span>
  </Button>
  <span role="status" class="sr-only">{{ said }}</span>
</template>
