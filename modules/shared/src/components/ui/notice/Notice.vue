<script setup lang="ts">
// An inline message box inside a panel: info, success, warning or error, with an optional title, text and button.
import { AlertTriangle, CheckCircle2, Info, XCircle } from "@lucide/vue";
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

const props = withDefaults(defineProps<{ variant?: "info" | "success" | "warning" | "error"; title?: string; class?: HTMLAttributes["class"] }>(), { variant: "info" });

const STYLES = {
  info: { icon: Info, box: "bg-info/10", tint: "text-info" },
  success: { icon: CheckCircle2, box: "bg-success/10", tint: "text-success" },
  warning: { icon: AlertTriangle, box: "bg-warning/10", tint: "text-warning" },
  error: { icon: XCircle, box: "bg-destructive/10", tint: "text-destructive" },
} as const;
</script>

<template>
  <div :role="props.variant === 'error' ? 'alert' : 'status'" data-slot="notice" :data-variant="props.variant" :class="cn('flex items-start gap-2 rounded-md p-3 text-sm', STYLES[props.variant].box, props.class)">
    <component :is="STYLES[props.variant].icon" :class="cn('mt-0.5 size-4 flex-none', STYLES[props.variant].tint)" :stroke-width="1.5" aria-hidden="true" />
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <p v-if="title" class="font-medium">{{ title }}</p>
      <div v-if="$slots.default"><slot /></div>
    </div>
    <div v-if="$slots.action" class="flex flex-none items-center"><slot name="action" /></div>
  </div>
</template>
