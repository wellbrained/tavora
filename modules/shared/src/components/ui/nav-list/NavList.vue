<script setup lang="ts">
// A vertical list of sections for a side navigation, such as the categories in Settings. Up and
// down arrows, Home and End move between entries; Tab enters and leaves the list in one stop.
import { computed, ref, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
import type { NavGroup } from "./types";

const props = defineProps<{ groups: NavGroup[]; label: string; modelValue?: string | null; class?: HTMLAttributes["class"]; headingClass?: HTMLAttributes["class"]; iconClass?: HTMLAttributes["class"] }>();
const emit = defineEmits<{
  "update:modelValue": [id: string];
  /** Every press, also on the entry that is already selected. */
  select: [id: string];
}>();

const list = ref<HTMLElement | null>(null);
const all = computed(() => props.groups.flatMap((group) => group.items));
/** The entry Tab lands on: the selected one, or else the first. */
const tabStop = computed(() => (all.value.some((item) => item.id === props.modelValue) ? props.modelValue : all.value[0]?.id));

function pick(id: string) {
  emit("update:modelValue", id);
  emit("select", id);
}

function onKey(event: KeyboardEvent) {
  const steps: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 };
  const buttons = [...(list.value?.querySelectorAll<HTMLButtonElement>("button[data-nav-item]") ?? [])];
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  if (at < 0) return;
  let next: number;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else if (event.key in steps) next = (at + steps[event.key]! + buttons.length) % buttons.length;
  else return;
  event.preventDefault();
  buttons[next]?.focus();
}
</script>

<template>
  <nav ref="list" data-slot="nav-list" :aria-label="label" :class="cn('flex flex-col gap-0.5', props.class)" @keydown="onKey">
    <template v-for="(group, index) in groups" :key="group.heading ?? index">
      <h3 v-if="group.heading" :class="cn('text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wider uppercase', index > 0 && 'pt-4', props.headingClass)">{{ group.heading }}</h3>
      <button
        v-for="item in group.items"
        :key="item.id"
        type="button"
        data-nav-item
        :tabindex="item.id === tabStop ? 0 : -1"
        :aria-current="item.id === modelValue ? 'page' : undefined"
        :title="item.title"
        :data-testid="item.testid"
        :style="item.level ? { paddingLeft: `calc(0.75rem + ${item.level} * 1rem)` } : undefined"
        :class="
          cn(
            'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring group flex h-9 shrink-0 items-center gap-3 rounded-lg px-3 text-left font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:-outline-offset-2',
            item.id === modelValue && 'bg-primary/10 text-foreground hover:bg-primary/15',
          )
        "
        @click="pick(item.id)"
      >
        <component :is="item.icon" v-if="item.icon" :class="cn('size-4 flex-none transition-colors', item.id === modelValue ? 'text-primary' : 'group-hover:text-primary/80', props.iconClass)" :stroke-width="1.75" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
        <span
          v-if="item.status"
          role="img"
          :aria-label="item.statusLabel"
          :data-status="item.status"
          :class="cn('size-[7px] flex-none rounded-full', item.status === 'on' ? 'bg-success' : 'shadow-[inset_0_0_0_1.5px_var(--input)]')"
        />
        <span v-if="item.badge !== undefined" :data-testid="item.badgeTestid" :class="cn('text-xs tabular-nums', item.badgeAccent ? 'bg-primary text-primary-foreground rounded-sm px-1.5' : item.id === modelValue ? 'text-primary' : 'text-muted-foreground')">{{ item.badge }}</span>
      </button>
    </template>
  </nav>
</template>
