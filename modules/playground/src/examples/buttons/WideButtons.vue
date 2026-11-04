<script setup lang="ts">
// A wide control only dips 1px when pressed; the small ones also shrink a little. Press and hold each to compare.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { ref } from "vue";

const place = ref("berlin");
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <Button variant="secondary" size="sm">Small</Button>
      <Button variant="secondary" size="xs">Tiny</Button>
    </div>
    <Button variant="secondary" class="w-full">Wide button</Button>
    <Picker
      v-model="place"
      label="Place"
      class="w-full max-w-none"
      :options="[
        { value: 'berlin', label: 'Berlin' },
        { value: 'lisbon', label: 'Lisbon' },
        { value: 'oslo', label: 'Oslo' },
      ]"
    />
  </div>
</template>
