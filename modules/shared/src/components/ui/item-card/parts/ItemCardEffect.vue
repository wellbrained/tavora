<script setup lang="ts">
// The effect text (`effect`), accented runs (numbers, keywords) in the accent colour: in its box on a card, plain on a
// unit (`unit`). A "\n" in the text is a line break.
import type { TooltipContent } from "@tavora/sdk"
import { computed } from "vue"
import { renderRuns } from "../../../tooltip/parts"
import { effectRuns } from "../content"

const props = defineProps<{ content: TooltipContent; unit?: boolean }>()
const runs = computed(() => effectRuns(props.content))
const Runs = () => renderRuns(runs.value)
</script>

<template>
  <p v-if="runs.length" :class="unit ? 'tavora-item-card-unit-effect' : 'tavora-item-card-effect'"><Runs /></p>
</template>
