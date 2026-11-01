<script setup lang="ts">
// Screen 1: a map of the app. A drawn window with numbered parts; Next walks Workspace, Panel, Module and
// lights each one in place with a sentence. After the last part, Next leaves the map.
import { Check } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "../../i18n";
import AppSkeleton, { type SkeletonPart } from "./AppSkeleton.vue";

const emit = defineEmits<{ next: [] }>();

const PARTS: SkeletonPart[] = ["workspace", "panel", "module"];
/** The part shown now. */
const index = ref(0);
const lit = computed(() => PARTS[index.value]!);

function next() {
  if (index.value < PARTS.length - 1) index.value++;
  else emit("next");
}
</script>

<template>
  <section class="flex w-full max-w-[720px] flex-col items-center text-center" data-testid="onboarding-map">
    <h1 class="text-3xl font-semibold">{{ t("onboarding.map.title") }}</h1>
    <p class="text-muted-foreground mt-2 mb-6 [@media(max-height:640px)]:mb-3">{{ t("onboarding.map.sub") }}</p>

    <div class="flex w-full flex-col items-stretch gap-4 text-left sm:flex-row">
      <div class="h-44 min-w-0 flex-1 sm:h-56 [@media(max-height:640px)]:h-36">
        <AppSkeleton :lit="lit" numbers />
      </div>
      <ol class="flex flex-col gap-1.5 sm:w-52 sm:flex-none" :aria-label="t('onboarding.map.parts')">
        <li
          v-for="(part, position) in PARTS"
          :key="part"
          :class="cn('rounded-lg border border-transparent px-3 py-2 transition-colors', part === lit && 'border-primary bg-primary/10')"
          :aria-current="part === lit ? 'step' : undefined"
          :data-testid="`onboarding-map-${part}`"
        >
          <span :class="cn('flex items-center gap-1.5 text-sm font-medium', part !== lit && 'text-muted-foreground')">
            {{ position + 1 }} · {{ t(`onboarding.map.${part}.name`) }}
            <Check v-if="position < index" class="text-primary size-3.5" :stroke-width="2" />
          </span>
          <span v-if="part === lit" class="text-muted-foreground mt-0.5 block text-sm" data-testid="onboarding-map-text">{{ t(`onboarding.map.${part}.text`) }}</span>
        </li>
      </ol>
    </div>

    <Button class="mt-6 min-w-32 [@media(max-height:640px)]:mt-3" data-testid="onboarding-next" @click="next">{{ t("common.next") }}</Button>
  </section>
</template>
