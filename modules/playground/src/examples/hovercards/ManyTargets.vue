<script setup lang="ts">
// One card for a whole list: `useHoverCard()` moves it from name to name, as `useTooltip()` does for tooltips. While a
// card is pinned, hovering the other names opens nothing; clicking another name moves the pin there.
import { Plus } from "@lucide/vue";
import { TooltipRows } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { HoverCard, HoverCardContent, useHoverCard } from "@tavora/official-ui/components/ui/hover-card";
import { ref } from "vue";

interface Spell { name: string; kind: string; text: string; cost: string }
const spells: Spell[] = [
  { name: "Frost Ward", kind: "Ward", text: "Covers you in ice that soaks up the next hits.", cost: "40 mana" },
  { name: "Fireball", kind: "Attack", text: "Throws a ball of fire that bursts where it lands.", cost: "25 mana" },
  { name: "Blink", kind: "Movement", text: "Takes you a few steps ahead in an instant.", cost: "15 mana" },
];
const build = ref<string[]>([]);
const add = (name: string) => { if (!build.value.includes(name)) build.value.push(name); };
const card = useHoverCard<Spell>({ pinnable: true });
</script>

<template>
  <ul class="flex flex-col gap-0.5 text-sm">
    <li v-for="spell in spells" :key="spell.name" class="flex items-center gap-2">
      <span class="font-medium underline decoration-dotted underline-offset-4" v-bind="card.on(spell, { focusable: true })">{{ spell.name }}</span>
      <span class="text-muted-foreground">· {{ spell.kind }}</span>
      <!-- What the card offers works without it too: touch and screen readers may never open it. -->
      <Button size="xs" variant="ghost" :disabled="build.includes(spell.name)" @click="add(spell.name)"><Plus /> Add</Button>
    </li>
  </ul>
  <p v-if="build.length" class="text-muted-foreground mt-2 text-sm">In your build: {{ build.join(", ") }}</p>
  <HoverCard v-bind="card.props">
    <HoverCardContent :title="card.content?.name" :description="card.content?.text">
      <hr />
      <TooltipRows :rows="[{ label: 'Kind', value: card.content?.kind ?? '' }, { label: 'Cost', value: card.content?.cost ?? '' }]" />
      <Button class="mt-3" size="xs" :disabled="build.includes(card.content?.name ?? '')" @click="card.content && add(card.content.name)"><Plus /> Add to build</Button>
    </HoverCardContent>
  </HoverCard>
</template>
