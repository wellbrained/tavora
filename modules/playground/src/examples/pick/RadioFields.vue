<script setup lang="ts">
import { RadioField } from "@tavora/official-ui/components/ui/radio-field";
import { RadioGroup } from "@tavora/official-ui/components/ui/radio-group";
import { ref } from "vue";

const target = ref("current");
</script>

<template>
  <RadioGroup v-model="target" class="max-w-80 gap-0.5" aria-label="Where to import">
    <RadioField value="current" label="Into Iron Valley" data-testid="radio-field" />
    <RadioField value="new" label="As a new world" description="Your other worlds stay as they are." />
    <RadioField value="merge" label="Add to what is there" size="sm">
      <template #trailing>124</template>
    </RadioField>
    <RadioField value="cloud" label="Cloud world" disabled disabled-reason="Sign in first." />
  </RadioGroup>
</template>
