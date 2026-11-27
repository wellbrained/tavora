<script setup lang="ts">
// The popover's panel, drawn above everything else with the same surface as a menu.
// `focus="none"` is for a panel that only shows something next to a field or a board (suggestions, a toolbar over a
// picked slot): the focus never moves into it, a press on it keeps the focus where it was, and it isn't announced as a
// dialog, so what it holds brings its own role (a listbox, a toolbar). `dismissIgnore` names places a click or a focus
// move may land without putting the panel away (the board the panel belongs to).
import type { FocusOutsideEvent, PointerDownOutsideEvent, PopoverContentEmits, PopoverContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { useAttrs } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { PopoverContent, PopoverPortal, useForwardPropsEmits } from "reka-ui";
import { cn } from "../../../lib/utils";
import { leaveToolbar } from "../toolbar/context";
import { type DismissIgnore, isDismissIgnored } from "./dismiss-ignore";

// What it holds is not part of a Toolbar around its trigger.
leaveToolbar();

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<
    PopoverContentProps & {
      class?: HTMLAttributes["class"];
      /** `none`: the panel never takes the focus, so typing stays in the field. */
      focus?: "content" | "none";
      /** Places a click or a focus move may land without closing the panel: an element, a ref, a selector or a list. */
      dismissIgnore?: DismissIgnore;
    }
  >(),
  { align: "center", sideOffset: 4, collisionPadding: 8, focus: "content", dismissIgnore: undefined },
);
const emits = defineEmits<PopoverContentEmits>();

const delegatedProps = reactiveOmit(props, "class", "focus", "dismissIgnore");
const forwarded = useForwardPropsEmits(delegatedProps, emits);

// Placed after the forwarded handlers: each one runs the caller's own handler too, once the kit has had its say.
const handlers = {
  onOpenAutoFocus(event: Event) {
    if (props.focus === "none") event.preventDefault();
    emits("openAutoFocus", event);
  },
  onCloseAutoFocus(event: Event) {
    if (props.focus === "none") event.preventDefault();
    emits("closeAutoFocus", event);
  },
  onInteractOutside(event: PointerDownOutsideEvent | FocusOutsideEvent) {
    if (isDismissIgnored(event.detail.originalEvent.target, props.dismissIgnore)) event.preventDefault();
    emits("interactOutside", event);
  },
};

// Nothing moves into the panel, so it isn't a dialog; a role of the caller's wins. Reka sets "dialog" on the panel
// after anything passed in, so the role is changed on the element itself.
const attrs = useAttrs();
function setRole(root: HTMLElement) {
  if (props.focus !== "none") return;
  const panel = root.matches("[data-slot=popover-content]") ? root : root.querySelector("[data-slot=popover-content]");
  panel?.setAttribute("role", String(attrs.role ?? "presentation"));
}
const vPanelRole = { mounted: setRole, updated: setRole };

/** A press on the panel must not move the focus off the field, except onto a field inside the panel. */
function keepFocus(event: MouseEvent) {
  if (props.focus !== "none") return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
}
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      data-slot="popover-content"
      v-panel-role
      v-bind="{ ...$attrs, ...forwarded, ...handlers }"
      :class="cn('bg-popover text-popover-foreground tavora-popup focus-visible:outline-ring z-(--layer-floating) w-72 max-w-[calc(100vw-16px)] rounded-md border p-3 shadow-elevation-2 outline-hidden', props.class)"
      @mousedown="keepFocus"
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
