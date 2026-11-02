<script setup lang="ts">
import { SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const segmentMixed = ref<"a" | "b" | "c" | undefined>(undefined);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <SegmentedControl
      :model-value="segmentMixed ?? ('none' as 'a')"
      label="Mixed"
      :disabled="off"
      :options="[
        { value: 'a', label: 'Always' },
        { value: 'b', label: 'On a key' },
      ]"
      @update:model-value="segmentMixed = $event"
    />
    <Button variant="ghost" size="sm" :disabled="off" @click="segmentMixed = undefined">Clear</Button>
    <SegmentedControl model-value="week" label="Locked" disabled :options="[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]" />
  </div>
</template>
