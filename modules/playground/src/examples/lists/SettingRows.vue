<script setup lang="ts">
import { SegmentedControl } from "@tavora/official-ui";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const showFinished = ref(true);
const density = ref<"tight" | "normal">("normal");
</script>

<template>
  <div class="flex flex-col">
    <div class="flex items-center gap-6 py-3">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-sm font-medium">Show finished</span>
        <span class="text-muted-foreground text-xs">Keep done to-dos in the list.</span>
      </div>
      <Switch v-model="showFinished" aria-label="Show finished" :disabled="off" />
    </div>
    <Separator />
    <div class="flex items-center gap-6 py-3">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-sm font-medium">Density</span>
        <span class="text-muted-foreground text-xs">How much space rows take.</span>
      </div>
      <SegmentedControl
        v-model="density"
        label="Density"
        :disabled="off"
        :options="[
          { value: 'tight', label: 'Tight' },
          { value: 'normal', label: 'Normal' },
        ]"
      />
    </div>
  </div>
</template>
