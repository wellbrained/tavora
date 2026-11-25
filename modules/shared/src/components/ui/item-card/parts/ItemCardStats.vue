<script setup lang="ts">
// The card's stats (`properties`): label, value, extra value columns (`more`, under `columns`), and what a stat grows by
// (`per`, under `perHeading`), lined up in columns. An icon before a label (`icon`) is drawn as a mask in the label's
// colour; when a stat has one, every label keeps its room so the labels line up. A "–" in an extra column is faint.
import type { TooltipContent } from "@tavora/sdk"
import { computed } from "vue"
import { maskUrl, ownValue } from "../content"

const props = defineProps<{ content: TooltipContent }>()
// A third stats column only when a stat of this card grows (`per`).
const hasPer = computed(() => !!props.content.properties?.some((p) => p.per !== undefined))
// Extra value columns after the value: as many as the longest row or the headings ask for, up to 3.
const extra = computed(() => Math.min(3, Math.max(0, (props.content.columns?.length ?? 0) - 1, ...(props.content.properties ?? []).map((p) => p.more?.length ?? 0))))
const numberColumns = computed(() => 1 + extra.value + (hasPer.value ? 1 : 0))
const hasIcons = computed(() => !!props.content.properties?.some((p) => p.icon !== undefined))
const icons = computed(() => (props.content.properties ?? []).map((p) => maskUrl(p.icon)))
</script>

<template>
  <div v-if="content.properties?.length" class="tavora-item-card-stats" :data-per="hasPer ? '' : undefined" :data-columns="extra ? '' : undefined" :data-icons="hasIcons ? '' : undefined" :style="extra ? { '--ic-columns': String(numberColumns) } : undefined">
    <!-- The heading row: `columns` over the value and the extra columns, `perHeading` over what a stat grows by. -->
    <template v-if="content.columns?.length"><span /><template v-for="h in extra + 1" :key="`h${h}`"><span v-if="content.columns[h - 1]" class="tavora-item-card-per-heading">{{ content.columns[h - 1] }}</span><span v-else /></template><template v-if="hasPer"><span v-if="content.perHeading" class="tavora-item-card-per-heading">{{ content.perHeading }}</span><span v-else /></template></template>
    <template v-else-if="hasPer && content.perHeading"><span /><span /><span v-for="h in extra" :key="`h${h}`" /><span class="tavora-item-card-per-heading">{{ content.perHeading }}</span></template>
    <template v-for="(p, i) in content.properties" :key="i"><span class="tavora-item-card-label"><span v-if="hasIcons" class="tavora-item-card-icon" aria-hidden="true" :data-drawn="icons[i] ? '' : undefined" :style="icons[i] ? { '--ic-icon': icons[i] } : undefined" />{{ p.label }}</span><span class="tavora-item-card-value">{{ ownValue(p) }}</span><span v-for="m in extra" :key="`m${m}`" class="tavora-item-card-more" :data-faint="p.more?.[m - 1] === '–' ? '' : undefined">{{ p.more?.[m - 1] ?? "" }}</span><span v-if="hasPer" class="tavora-item-card-per">{{ p.per ?? "" }}</span></template>
  </div>
</template>
