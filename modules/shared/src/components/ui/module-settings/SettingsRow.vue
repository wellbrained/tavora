<script setup lang="ts">
// One setting: its name and an optional hint on the left, the control on the right in a column as
// wide on every page (224px), so controls line up. `stacked` puts a wide control under the name.
// Controls that wrap onto a second line keep the same room above and below as one-line rows.
// `danger` is for a row that deletes something: its name is red; the button in it is a destructive Button.
import { useId } from "vue";
import { cn } from "../../../lib/utils";

defineProps<{ label: string; hint?: string; stacked?: boolean; danger?: boolean }>();
const id = useId();
</script>

<template>
  <div
    :class="cn('border-border/70 flex border-b py-3 last:border-b-0', stacked ? 'flex-col gap-2.5' : 'min-h-14 items-center gap-6')"
    role="group"
    :aria-labelledby="`${id}-label`"
    data-slot="settings-row"
    :data-danger="danger || undefined"
  >
    <div class="min-w-0 flex-1">
      <p :id="`${id}-label`" :class="cn('text-sm', danger && 'text-destructive')">{{ label }}</p>
      <p v-if="hint" class="text-muted-foreground mt-0.5 text-xs">{{ hint }}</p>
    </div>
    <div :class="cn('flex items-center gap-1.5', stacked ? 'w-full' : 'w-56 flex-none justify-end')"><slot /></div>
  </div>
</template>
