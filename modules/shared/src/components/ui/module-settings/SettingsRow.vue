<script setup lang="ts">
// One setting: its name and an optional hint on the left, the control on the right in a column as
// wide on every page (224px), so controls line up. `stacked` puts a wide control under the name.
// Controls that wrap onto a second line keep the same room above and below as one-line rows.
// In a dialog too narrow for the column beside the name (160px of it at least), the control goes under the name,
// and a name that is one long word breaks.
// `danger` is for a row that deletes something: its name is red; the button in it is a destructive Button.
import { useId } from "vue";
import { cn } from "../../../lib/utils";

defineProps<{ label: string; hint?: string; stacked?: boolean; danger?: boolean }>();
const id = useId();
</script>

<template>
  <div
    :class="cn('border-border/70 flex border-b py-3 last:border-b-0', stacked ? 'flex-col gap-2.5' : 'min-h-14 flex-wrap items-center gap-x-6 gap-y-2.5')"
    role="group"
    :aria-labelledby="`${id}-label`"
    data-slot="settings-row"
    :data-danger="danger || undefined"
  >
    <div :class="cn('flex-1 break-words', stacked ? 'min-w-0' : 'min-w-40')">
      <p :id="`${id}-label`" :class="cn('text-sm', danger && 'text-destructive')">{{ label }}</p>
      <p v-if="hint" class="text-muted-foreground mt-0.5 text-xs">{{ hint }}</p>
    </div>
    <div :class="cn('flex items-center gap-1.5', stacked ? 'w-full' : 'ml-auto w-56 max-w-full flex-none justify-end')"><slot /></div>
  </div>
</template>
