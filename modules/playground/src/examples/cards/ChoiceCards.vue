<script setup lang="ts">
import { ChoiceCard } from "@tavora/official-ui/components/ui/card";
import { RadioGroup } from "@tavora/official-ui/components/ui/radio-group";
import { ref } from "vue";

const mode = ref("casual");
</script>

<template>
  <RadioGroup v-model="mode" aria-label="Game mode" class="max-w-xl grid-cols-2 gap-3" data-testid="choice-cards">
    <ChoiceCard value="casual" title="Casual" description="No timer, hints on." />
    <ChoiceCard value="ranked" title="Ranked" description="Timed, counts toward your rank.">
      <template #media>
        <span class="absolute inset-3 rounded bg-primary/30" />
      </template>
    </ChoiceCard>
  </RadioGroup>
</template>
