<script setup lang="ts">
// A value that is none of the options picks nothing; a disabled control shows no pill either.
import { SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const mode = ref<"a" | "b" | undefined>(undefined);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <SegmentedControl
      :model-value="mode ?? ('none' as 'a')"
      label="Mixed"
      :disabled="disabled"
      :options="[
        { value: 'a', label: 'Always' },
        { value: 'b', label: 'On a key' },
      ]"
      @update:model-value="mode = $event"
    />
    <Button variant="ghost" size="sm" :disabled="disabled" @click="mode = undefined">Clear</Button>
    <SegmentedControl model-value="week" label="Locked" disabled :options="[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]" />
  </div>
</template>
