<script setup lang="ts">
import { CheckboxField } from "@tavora/official-ui/components/ui/checkbox-field";
import { ref } from "vue";

const layers = ref({ iron: true, copper: true, coal: false });
const all = () => {
  const on = Object.values(layers.value);
  return on.every(Boolean) ? true : on.some(Boolean) ? "indeterminate" : false;
};
const setAll = (value: boolean | "indeterminate") => {
  for (const key of Object.keys(layers.value) as (keyof typeof layers.value)[]) layers.value[key] = value === true;
};
const adult = ref(false);
</script>

<template>
  <div class="flex max-w-80 flex-col gap-0.5">
    <CheckboxField :model-value="all()" label="All ores" data-testid="checkbox-field-all" @update:model-value="setAll" />
    <CheckboxField v-model="layers.iron" label="Iron ore" data-testid="checkbox-field">
      <template #leading><span class="size-3 rounded-sm bg-primary" /></template>
      <template #trailing>124</template>
    </CheckboxField>
    <CheckboxField v-model="layers.copper" label="Copper ore">
      <template #leading><span class="size-3 rounded-sm bg-destructive" /></template>
      <template #trailing>86</template>
    </CheckboxField>
    <CheckboxField v-model="layers.coal" label="Coal" size="sm">
      <template #leading><span class="size-3 rounded-sm bg-muted-foreground" /></template>
      <template #trailing>41</template>
    </CheckboxField>
    <CheckboxField v-model="adult" label="I am over 18" description="You need this to join public servers." />
    <CheckboxField :model-value="true" label="Locked by your admin" disabled disabled-reason="Ask your admin to change it." />
  </div>
</template>
