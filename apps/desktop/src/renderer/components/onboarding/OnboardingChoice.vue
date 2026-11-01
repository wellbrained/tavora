<script setup lang="ts">
// Screen 2: "What do you want to try first?" Two cards, each with a tiny picture and real examples. The choice
// decides screen 3: a game search, or a personal space with ticked panels.
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ArrowLeft } from "@lucide/vue";
import { t } from "../../i18n";
import AppSkeleton from "./AppSkeleton.vue";

export type FirstChoice = "game" | "personal";

defineEmits<{ pick: [FirstChoice]; back: [] }>();

// Names of modules: the built-in ones, and the game modules the catalog has.
const EXAMPLES: Record<FirstChoice, string[]> = {
  game: ["Palworld", "Satisfactory Planner", "Enshrouded Builds", "PoE2 Builds"],
  personal: ["Notes", "To-Dos", "Clock & Counter", "Whiteboard", "PDF Viewer"],
};
</script>

<template>
  <section class="flex w-full max-w-[640px] flex-col items-center text-center" data-testid="onboarding-choice">
    <h1 class="text-3xl font-semibold">{{ t("onboarding.choice.title") }}</h1>
    <p class="text-muted-foreground mt-2 mb-6 [@media(max-height:640px)]:mb-3">{{ t("onboarding.choice.sub") }}</p>

    <div class="grid w-full grid-cols-2 gap-3 max-[760px]:gap-2">
      <button
        v-for="kind in (['game', 'personal'] as const)"
        :key="kind"
        type="button"
        class="bg-card hover:border-primary/60 focus-visible:border-ring focus-visible:ring-ring/50 flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-3 max-[760px]:p-3"
        :data-testid="`onboarding-pick-${kind}`"
        @click="$emit('pick', kind)"
      >
        <span class="h-24 w-full [@media(max-height:640px)]:h-16"><AppSkeleton :kind="kind" :panels="kind === 'game' ? 2 : 1" /></span>
        <span class="flex flex-col gap-0.5">
          <span class="font-medium">{{ t(`onboarding.choice.${kind}.title`) }}</span>
          <span class="text-muted-foreground text-sm">{{ t(`onboarding.choice.${kind}.text`) }}</span>
        </span>
        <span class="flex flex-wrap gap-1" :aria-label="t('onboarding.choice.examples')">
          <Badge v-for="example in EXAMPLES[kind]" :key="example" variant="secondary">{{ example }}</Badge>
        </span>
      </button>
    </div>

    <Button variant="ghost" class="mt-5" data-testid="onboarding-back" @click="$emit('back')"><ArrowLeft :stroke-width="1.5" /> {{ t("common.back") }}</Button>
  </section>
</template>
