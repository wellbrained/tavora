<script setup lang="ts">
import { ChoiceCard } from "@tavora/official-ui/components/ui/card";
import { RadioGroup } from "@tavora/official-ui/components/ui/radio-group";
import { Coffee, Trophy } from "@lucide/vue";
import { ref } from "vue";

const mode = ref("casual");
</script>

<template>
  <RadioGroup v-model="mode" aria-label="Game mode" class="max-w-xl grid-cols-2 gap-3" data-testid="choice-cards">
    <ChoiceCard value="casual" title="Casual" description="No timer, hints on.">
      <template #media>
        <span class="absolute inset-3 rounded-md bg-primary/20" />
      </template>
    </ChoiceCard>
    <ChoiceCard value="ranked" title="Ranked" description="Timed, counts toward your rank.">
      <template #media>
        <span class="absolute inset-3 rounded-md bg-primary/30" />
      </template>
    </ChoiceCard>
  </RadioGroup>
  <RadioGroup v-model="mode" aria-label="Game mode" class="mt-3 max-w-xl grid-cols-2 gap-3" data-testid="choice-cards-icons">
    <ChoiceCard value="casual" size="sm" :icon="Coffee" title="Casual" description="No timer, hints on." />
    <ChoiceCard value="ranked" size="sm" :icon="Trophy" title="Ranked" description="Timed, counts toward your rank." />
  </RadioGroup>
</template>
