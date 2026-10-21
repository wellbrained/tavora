<script setup lang="ts">
// A link to another Codex entry, with its icon, and a tooltip for items and recipes.
import { language, locale, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule, useNames } from "../context";
import type { Entry } from "../search";
import { itemTooltip, recipeTooltip } from "../tooltip";

const props = withDefaults(defineProps<{ entry: Entry; size?: number; icon?: boolean }>(), { size: 20, icon: true });
const emit = defineEmits<{ go: [entry: Entry] }>();

const context = useModule();
const { data } = context.services;
const vTip = context.tip;
const names = useNames(context);

const picture = () =>
  props.entry.kind === "item" ? data.items[props.entry.id]?.icon : props.entry.kind === "building" ? data.buildings[props.entry.id]?.icon : undefined;
const tooltip = () =>
  props.entry.kind === "item"
    ? itemTooltip(data, props.entry.id, language.value, locale(), t)
    : props.entry.kind === "recipe"
      ? recipeTooltip(data, props.entry.id, language.value, locale(), t)
      : null;
</script>

<template>
  <button
    v-tip="tooltip"
    type="button"
    class="hover:text-primary focus-visible:outline-ring inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2"
    data-testid="entry-link"
    @click="emit('go', entry)"
  >
    <GameIcon v-if="icon && entry.kind !== 'recipe'" :icon="picture()" :kind="entry.kind === 'building' ? 'building' : 'item'" :size="size" />
    <span class="min-w-0 truncate"><slot>{{ names.entry(entry) }}</slot></span>
  </button>
</template>
