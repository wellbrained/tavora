<script setup lang="ts">
// One toast: a title, an optional line and button, and a close button. The timer stops while
// the pointer or the keyboard focus is on it, then runs on with the time that was left.
import { X } from "@lucide/vue";
import { onBeforeUnmount, onMounted } from "vue";
import { cn } from "../../../lib/utils";
import { Button } from "../button";
import { uiText } from "../text";
import { dismissToast, TOAST_DURATION, type ToastItem } from "./toast";

const props = defineProps<{ item: ToastItem }>();

let remaining = props.item.duration ?? TOAST_DURATION;
let startedAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let hovered = false;
let focused = false;

function start() {
  startedAt = Date.now();
  timer = setTimeout(() => dismissToast(props.item.id), remaining);
}
function pause() {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  remaining = Math.max(remaining - (Date.now() - startedAt), 1000);
}
function setHovered(on: boolean) {
  hovered = on;
  sync();
}
function setFocused(on: boolean) {
  focused = on;
  sync();
}
function sync() {
  if (hovered || focused) pause();
  else if (timer === undefined) start();
}

onMounted(start);
onBeforeUnmount(() => clearTimeout(timer));

function runAction() {
  props.item.action?.onClick();
  dismissToast(props.item.id);
}
</script>

<template>
  <div
    data-slot="toast"
    :data-variant="item.variant ?? 'default'"
    :class="
      cn(
        'bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border p-3 text-sm shadow-md',
        item.variant === 'error' && 'border-destructive/50',
      )
    "
    @pointerenter="setHovered(true)"
    @pointerleave="setHovered(false)"
    @focusin="setFocused(true)"
    @focusout="setFocused(false)"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <p :class="cn('font-medium', item.variant === 'error' && 'text-destructive')">{{ item.title }}</p>
      <p v-if="item.description" class="text-muted-foreground text-xs">{{ item.description }}</p>
    </div>
    <Button v-if="item.action" type="button" size="xs" variant="secondary" class="flex-none" @click="runAction">{{ item.action.label }}</Button>
    <Button type="button" size="icon-xs" variant="ghost" class="-mt-0.5 -mr-1 flex-none" :aria-label="uiText.dismiss" :title="uiText.dismiss" @click="dismissToast(item.id)">
      <X :stroke-width="1.5" />
    </Button>
  </div>
</template>
