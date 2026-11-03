<script setup lang="ts">
// OverlayText: the text of an overlay in its box, the same piece every text overlay uses (Clock & Counter first), and
// OverlayTextSettings, the section of a module's settings that sets it up. A fixed box keeps the text at its size and alignment;
// only a text too long for it scrolls, shrinks or is cut off. A box that grows with the text draws it bigger with the box (in
// Tavora's frames the box follows the text).
import { DEFAULT_OVERLAY_TEXT_BOX, OverlayText, OverlayTextSettings, type OverlayTextBoxSettings } from "@tavora/official-ui/components/ui/overlay-text";
import { ref } from "vue";

// The settings say only what changed; a module saves that field.
const settings = ref<OverlayTextBoxSettings>({ ...DEFAULT_OVERLAY_TEXT_BOX, box: "fixed" });
const LONG = "Now playing: a very long song title by a band with an even longer name";
const box = "bg-muted h-12 w-72 rounded-md";
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="max-w-xl">
      <OverlayTextSettings :value="settings" @change="(change) => (settings = { ...settings, ...change })" />
    </div>
    <div class="flex flex-col gap-1 text-xl font-semibold">
      <span class="text-muted-foreground text-xs font-normal">With these settings</span>
      <OverlayText :class="settings.box === 'fixed' ? box : 'bg-muted h-12 w-auto self-start rounded-md'" v-bind="settings" scale-by="down" :padding="8" :font-size="20"><div>{{ LONG }}</div></OverlayText>
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
        <OverlayText :class="box" box="fixed" too-long="scroll" :padding="8" :font-size="20"><div>{{ LONG }}</div></OverlayText>
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
