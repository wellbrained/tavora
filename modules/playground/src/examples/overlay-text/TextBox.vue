<script setup lang="ts">
// OverlayText: the text of an overlay in its box, the same piece every text overlay uses (Clock & Counter first). A fixed box
// keeps the text at its size and alignment; only a text too long for it scrolls, shrinks or is cut off. A box that grows with
// the text draws it bigger with the box (in Tavora's frames the box follows the text).
import { SegmentedControl } from "@tavora/official-ui";
import { OVERLAY_TEXT_PAUSES, OverlayText, type OverlayTextSpeed } from "@tavora/official-ui/components/ui/overlay-text";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { ref } from "vue";

const speed = ref<OverlayTextSpeed>("normal");
const pause = ref("2");
const soft = ref(true);
const SPEEDS = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
];
const LONG = "Now playing: a very long song title by a band with an even longer name";
const box = "bg-muted h-12 w-72 rounded-md";
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-4">
      <SegmentedControl v-model="speed" label="Scroll speed" :options="SPEEDS" />
      <label class="flex items-center gap-2 text-sm">
        Pause, in seconds
        <Select v-model="pause">
          <SelectTrigger size="sm" class="w-20" aria-label="Pause, in seconds">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="value in OVERLAY_TEXT_PAUSES" :key="value" :value="String(value)">{{ value === 0 ? "Off" : value }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label class="flex items-center gap-2 text-sm"><Switch v-model="soft" /> Soft edges</label>
    </div>

    <div class="flex flex-col gap-3 text-xl font-semibold">
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs font-normal">Short text keeps its size, sits left</span>
        <OverlayText :class="box" box="fixed" align="left" :padding="8" :font-size="20"><div>Deaths 7</div></OverlayText>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs font-normal">Fits: no scrolling</span>
        <OverlayText :class="box" box="fixed" :padding="8" :font-size="20"><div>Boss in 4:59</div></OverlayText>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs font-normal">Too long → Scroll: pause, run through, loop</span>
        <OverlayText :class="box" box="fixed" too-long="scroll" :speed="speed" :pause="Number(pause)" :soft-edges="soft" :padding="8" :font-size="20"><div>{{ LONG }}</div></OverlayText>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs font-normal">Too long → Shrink</span>
        <OverlayText :class="box" box="fixed" too-long="shrink" :padding="8" :font-size="20"><div>{{ LONG }}</div></OverlayText>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs font-normal">Too long → Cut off</span>
        <OverlayText :class="box" box="fixed" too-long="cut" :padding="8" :font-size="20"><div>{{ LONG }}</div></OverlayText>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs font-normal">Grows with the text: drawn bigger with its box, never stretched</span>
        <div class="flex items-end gap-3">
          <OverlayText class="bg-muted h-8 w-24 rounded-md" box="grow" scale-by="fill" :padding="4" :font-size="20"><div>Deaths 7</div></OverlayText>
          <OverlayText class="bg-muted h-16 w-48 rounded-md" box="grow" scale-by="fill" :padding="8" :font-size="20"><div>Deaths 7</div></OverlayText>
        </div>
      </div>
    </div>
  </div>
</template>
