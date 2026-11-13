<script setup lang="ts">
// Things dragged onto slots: startDrag on the source, useDropTargets for the slots. The third slot takes only gems, so it
// shows no drop for the rest. A filled slot drags to another (two swap) or off the slots (it empties); the rules are the page's.
import { startDrag, useDropTargets } from "@tavora/official-ui/components/ui/drag-drop";
import { cn } from "@tavora/official-ui/lib/utils";
import { Gem, Shield, Sword } from "@lucide/vue";
import { ref, type Component } from "vue";

type ItemId = "sword" | "shield" | "gem";
interface Carried {
  item: ItemId;
  /** The slot it comes from; none from the shelf. */
  from?: number;
}
const ITEMS: Record<ItemId, { label: string; icon: Component }> = { sword: { label: "Sword", icon: Sword }, shield: { label: "Shield", icon: Shield }, gem: { label: "Gem", icon: Gem } };
const SLOTS = ["0", "1", "2"] as const;
const slots = ref<(ItemId | null)[]>([null, null, null]);
const takes = (item: ItemId, slot: number) => slot !== 2 || item === "gem";

const drops = useDropTargets<Carried, (typeof SLOTS)[number]>("playground-item", {
  accepts: (carried, key) => {
    const to = Number(key);
    const there = slots.value[to];
    // A swap must suit both slots.
    return takes(carried.item, to) && (carried.from === undefined || !there || takes(there, carried.from));
  },
  drop: (carried, key) => {
    const to = Number(key);
    const next = [...slots.value];
    if (carried.from !== undefined) next[carried.from] = next[to] ?? null;
    next[to] = carried.item;
    slots.value = next;
  },
  outside: {
    accepts: (carried) => carried.from !== undefined,
    drop: (carried) => (slots.value = slots.value.map((item, index) => (index === carried.from ? null : item))),
  },
});
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="drop-on-slots" v-bind="drops.area">
    <div class="flex gap-2">
      <div
        v-for="(id, name) in ITEMS"
        :key="name"
        draggable="true"
        class="bg-card flex size-12 cursor-grab items-center justify-center rounded-lg border"
        :title="id.label"
        :data-testid="`drop-item-${name}`"
        @dragstart="startDrag($event, 'playground-item', { item: name })"
      >
        <component :is="id.icon" class="size-5" :stroke-width="1.5" aria-hidden="true" />
      </div>
    </div>
    <div class="flex gap-2">
      <div
        v-for="key in SLOTS"
        :key="key"
        v-bind="drops.target(key)"
        :draggable="!!slots[Number(key)]"
        :class="cn('flex size-16 items-center justify-center rounded-lg border border-dashed', drops.over.value === key && 'border-primary bg-primary/10 border-solid', slots[Number(key)] && 'cursor-grab border-solid')"
        :data-testid="`drop-slot-${key}`"
        @dragstart="startDrag($event, 'playground-item', { item: slots[Number(key)]!, from: Number(key) })"
      >
        <component :is="ITEMS[slots[Number(key)]!].icon" v-if="slots[Number(key)]" class="size-6" :stroke-width="1.5" aria-hidden="true" />
        <span v-else-if="key === '2'" class="text-muted-foreground text-xs">Gem</span>
      </div>
    </div>
  </section>
</template>
