<script setup lang="ts">
// The card's line across its bottom (`footer`): a text, or runs with a bold label ("Skill points: 3"), drawn by the kit's
// TooltipFooter, as the shared tooltip draws it above its own footer.
import type { TooltipContent } from "@tavora/sdk"
import { TooltipFooter, renderRuns } from "../../../tooltip/parts"

defineProps<{ content: TooltipContent }>()
const Runs = (props: { footer: NonNullable<TooltipContent["footer"]> }) => (typeof props.footer === "string" ? props.footer : renderRuns(props.footer))
</script>

<template>
  <TooltipFooter v-if="content.footer"><Runs :footer="content.footer" /></TooltipFooter>
</template>
