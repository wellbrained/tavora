<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { ButtonVariants } from "."
import { Check, LoaderCircle } from "@lucide/vue"
import { Primitive } from "reka-ui"
import { actionFailed } from "../../../lib/menu-action"
import { useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { uiText } from "../text"
import { clsx } from "clsx"
import { computed, mergeProps, onBeforeUnmount, onMounted, onUpdated, ref } from "vue"
import { ACTION_ICON_PADDING, BUTTON_ICON_PADDING, buttonVariants, setsOwnPadding } from "."
import { type ButtonAction, useButtonAction } from "./action"
import { useToolbarJoin } from "../toolbar/context"
import ToolbarItem from "../toolbar/ToolbarItem.vue"
// The check's pop (`tavora-progress-pop`), shared with ProgressButton.
import "../progress-button/progress-button.css"

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  /** `dip` (wide controls) only dips 1px when pressed; the default `scale` also shrinks to 97% and turns itself to `dip` when stretched. */
  press?: ButtonVariants["press"]
  class?: HTMLAttributes["class"]
  disabled?: boolean
  /**
   * Has a hint of its own (a tooltip you show yourself, not a `title`). A disabled button with a `title` or this stays
   * reachable, so the hint still shows and says why it is off. A disabled button without one is a plain disabled button.
   */
  hinted?: boolean
  /** Why it is off. While `disabled` the button stays hoverable and focusable, and the reason shows in a tooltip beside it. */
  disabledReason?: string
  /**
   * The work behind the button, run when it is pressed (see `action.ts`). A Promise keeps it busy: no second press, a
   * spinner after 300 ms. Return `false` when nothing happened (a dialog closed). A failure shows the kit's error toast.
   * With `as-child` it still runs and blocks a second press, but shows no states.
   */
  action?: ButtonAction
  /** Shown with a check for 2 s when the action worked ("Copied", "Saved"). Without it the button just goes back. */
  doneLabel?: string
  /** Shown with the spinner when the action runs longer than 1 s ("Saving…"). Not on an icon-only button. */
  busyLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
  disabled: false,
  hinted: false,
})

defineOptions({ inheritAttrs: false })

/**
 * A native `disabled` button gets no pointer events and no focus, so its tooltip never shows and a keyboard or screen
 * reader user can't reach the reason. With a hint it is `aria-disabled` instead: still hoverable and focusable, still
 * announced as off, but it takes no click, press or menu-opening key.
 */
/** The lighter icon side, unless the caller set its own padding. */
const iconPadding = computed(() => {
  if (setsOwnPadding(clsx(props.class))) return undefined
  const size = props.size ?? "default"
  if (!staged.value) return BUTTON_ICON_PADDING[size]
  return leadIcon.value ? ACTION_ICON_PADDING[size] : undefined
})

/** In a kit Toolbar it is one of the toolbar's arrow-key stops, and a switched-off one stays reachable (soft). */
const { joined } = useToolbarJoin()

const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason, hinted: props.hinted || joined.value }))

// --- The action and what the button says about it -------------------------------------------------------------------

/** The button shows its states (it wraps its content); not with as-child, where the content is the element itself. */
const staged = computed(() => !!props.action && !props.asChild)
const iconOnly = computed(() => String(props.size ?? "").startsWith("icon"))
const doneLabel = computed(() => (props.doneLabel ?? "").trim())
/** The busy label is written only on a button with text. */
const busyLabel = computed(() => (iconOnly.value ? "" : (props.busyLabel ?? "").trim()))

const run = useButtonAction({
  action: () => props.action,
  doneText: () => doneLabel.value,
  busyText: () => (props.busyLabel ?? "").trim() || uiText.value.working,
  failed: actionFailed,
})
onBeforeUnmount(run.dispose)

const state = run.state
const busy = computed(() => state.value.status === "busy")
const done = computed(() => state.value.status === "done")
const spinning = computed(() => state.value.status === "busy" && state.value.shows !== "nothing")
const labelShown = computed(() => state.value.status === "busy" && state.value.shows === "label" && busyLabel.value !== "")
const round = computed(() => (state.value.status === "done" ? state.value.round : 0))

/** Does the button's own content start with an icon? Then the spinner takes that icon's place. */
const own = ref<HTMLElement | null>(null)
const leadIcon = ref(false)
function measure() {
  let node = own.value?.firstChild ?? null
  // Skip what isn't there to see: Vue's comment anchors and white space.
  while (node && (node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim()))) node = node.nextSibling
  leadIcon.value = node instanceof SVGElement
}
onMounted(measure)
onUpdated(measure)

/** The button's own content steps aside while another text stands in its place. */
const ownHidden = computed(() => (done.value && doneLabel.value !== "") || labelShown.value || (spinning.value && !leadIcon.value))
/** The spinner sits on the leading icon. */
const spinOnIcon = computed(() => spinning.value && !labelShown.value && leadIcon.value)
/** A quiet button shows its check in the success colour; a filled one keeps its text colour, which reads on the fill. */
const quietCheck = computed(() => !["default", "destructive", undefined, null].includes(props.variant as string))

/** Busy: a press does nothing more, and nothing else that listens to the click hears it. */
function onPress(event: Event) {
  if (!props.action) return
  if (run.press()) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

/**
 * The root's attributes. The press listener is added only with an `action`: an extra click listener would make Vue drop
 * a click on a button that appeared in the same millisecond (its listeners compare the click's time with their own).
 */
const rootAttrs = () => (props.action ? mergeProps(soft.attrs(), { onClickCapture: onPress }) : soft.attrs())

const cell = "relative col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit] transition-opacity duration-(--duration-press) ease-(--ease-out-strong)"
// Every text takes the same cell, so the button is as wide as its widest state. The ones not shown are sized by a
// pseudo-element (never text), so the button's name is always its own content.
/** Gives a cell the room of its text without being that text. */
const sizer = "after:invisible after:content-[attr(data-label)]"
/** The text shown in a cell sits over it, centred. */
const overlay = "absolute inset-0 inline-flex items-center justify-center gap-[inherit]"
</script>

<template>
  <ToolbarItem :join="joined">
    <Primitive
      data-slot="button"
      :data-variant="variant ?? 'default'"
      :data-size="size ?? 'default'"
      :data-status="action ? state.status : undefined"
      :aria-busy="busy ? 'true' : undefined"
      :as="as"
      :as-child="asChild"
      v-bind="rootAttrs()"
      :data-disabled="joined ? undefined : soft.attrs()['data-disabled']"
      :class="cn('tavora-button', buttonVariants({ variant, size, press, soft: soft.soft() }), iconPadding, busy && 'cursor-progress', props.class)"
      :disabled="soft.disabled()"
    >
      <slot v-if="!staged" />
      <span v-else class="relative inline-grid items-center justify-items-center gap-[inherit]">
        <span ref="own" :class="[cell, ownHidden && 'opacity-0', spinOnIcon && '[&>svg:first-child]:opacity-0']">
          <slot />
          <span v-if="spinOnIcon" class="absolute inset-y-0 left-0 inline-flex items-center" aria-hidden="true">
            <LoaderCircle class="tavora-spin" />
          </span>
        </span>
        <span v-if="spinning && !leadIcon && !labelShown" :class="cell" aria-hidden="true"><LoaderCircle class="tavora-spin" /></span>
        <span v-if="busyLabel" :class="[cell, sizer, !labelShown && 'opacity-0']" :data-label="busyLabel" aria-hidden="true">
          <LoaderCircle class="invisible" />
          <span :class="overlay"><LoaderCircle :class="labelShown && 'tavora-spin'" /> {{ busyLabel }}</span>
        </span>
        <span v-if="doneLabel" :class="[cell, !iconOnly && sizer, !done && 'opacity-0']" :data-label="iconOnly ? undefined : doneLabel" aria-hidden="true">
          <Check class="invisible" />
          <span :class="overlay">
            <Check :key="round" :class="[done && 'tavora-progress-pop', quietCheck && 'text-success']" />
            <template v-if="!iconOnly">{{ doneLabel }}</template>
          </span>
        </span>
      </span>
    </Primitive>
  </ToolbarItem>
</template>
