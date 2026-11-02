<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { ButtonVariants } from "../button"
import { Check } from "@lucide/vue"
import { computed } from "vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { formatCount } from "../count-to"
import "./progress-button.css"

export type ProgressButtonStatus = "idle" | "busy" | "done"

interface Props {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
  /** Idle: the button as usual. Busy: it is the progress. Done: it says it worked, for as long as you keep it. */
  status?: ProgressButtonStatus
  /** While busy: how far along, 0 to 100. Leave it out (or null) when it can't be known: a stripe moves instead. */
  progress?: number | null
  /** Written while busy without a percent ("Installing…"). */
  busyLabel: string
  /** Written next to the tick when done ("Installed"). */
  doneLabel: string
  disabled?: boolean
  hinted?: boolean
}

const props = withDefaults(defineProps<Props>(), { status: "idle", progress: null, disabled: false, hinted: false })

const percent = computed(() => (props.progress === null ? null : Math.min(100, Math.max(0, props.progress))))
const locale = () => (typeof document === "undefined" ? undefined : document.documentElement.lang || undefined)
const percentLabel = computed(() => formatCount((percent.value ?? 0) / 100, "percent", locale()))

/** While it works or has worked, a click does nothing; it is not disabled, so it keeps its colours. */
function block(event: Event) {
  if (props.status === "idle") return
  event.preventDefault()
  event.stopImmediatePropagation()
}

// Every text takes the same cell, so the button is as wide as the widest and never jumps when the text changes.
const cell = "relative col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit] transition-opacity duration-(--duration-press) ease-(--ease-out-strong)"
</script>

<template>
  <Button
    data-slot="progress-button"
    :data-status="status"
    :variant="variant"
    :size="size"
    :disabled="disabled"
    :hinted="hinted"
    :aria-busy="status === 'busy' ? 'true' : undefined"
    :class="cn('relative overflow-hidden', props.class)"
    @click.capture="block"
  >
    <span v-if="status === 'busy'" class="pointer-events-none absolute inset-0" aria-hidden="true">
      <span
        v-if="percent !== null"
        class="absolute inset-0 origin-left bg-current opacity-25 transition-transform duration-(--duration-move) ease-(--ease-out-strong)"
        :style="{ transform: `scaleX(${percent / 100})` }"
      />
      <span v-else class="tavora-progress-stripe absolute inset-y-0 left-0 w-2/5 bg-current opacity-25" />
    </span>
    <span class="relative inline-grid items-center justify-items-center">
      <span :class="[cell, status !== 'idle' && 'opacity-0']" :aria-hidden="status !== 'idle' || undefined"><slot /></span>
      <span :class="[cell, status !== 'busy' && 'opacity-0']" :aria-hidden="status !== 'busy' || undefined">
        <span :class="percent === null ? '' : 'invisible'">{{ busyLabel }}</span>
        <span v-if="percent !== null" class="absolute inset-0 inline-flex items-center justify-center tabular-nums">{{ percentLabel }}</span>
      </span>
      <span :class="[cell, status !== 'done' && 'opacity-0']" :aria-hidden="status !== 'done' || undefined">
        <Check v-if="status === 'done'" class="tavora-progress-pop" :stroke-width="2" />
        <Check v-else class="invisible" :stroke-width="2" />
        {{ doneLabel }}
      </span>
    </span>
  </Button>
</template>
