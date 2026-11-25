<script setup lang="ts">
// The effect text (`effect`), accented runs (numbers, keywords) in the accent colour: in its box on a card, plain on a
// unit (`unit`).
import type { TooltipContent } from "@tavora/sdk"
import { computed } from "vue"
import { effectRuns } from "../content"

const props = defineProps<{ content: TooltipContent; unit?: boolean }>()
const runs = computed(() => effectRuns(props.content))
</script>

<template>
  <p v-if="runs.length" :class="unit ? 'tavora-item-card-unit-effect' : 'tavora-item-card-effect'"><template v-for="(run, i) in runs" :key="i"><span v-if="'accent' in run && run.accent" data-accent>{{ run.text }}</span><template v-else>{{ run.text }}</template></template></p>
</template>
