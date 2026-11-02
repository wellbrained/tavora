<script setup lang="ts">
import { Focus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";
import DemoSection from "../DemoSection.vue";
import Specimen from "../Specimen.vue";
import TileMapDemo from "./TileMapDemo.vue";
import ViewOnlyDemo from "./ViewOnlyDemo.vue";
import { type SectionId, sectionTitle as title } from "../sections";

defineProps<{ visible: Set<SectionId>; off: boolean }>();

// Steps of a made-up production line for the pan and zoom specimen.
const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
const pressed = ref<string>();
/** The steps shown in the auto-fit-off specimen; adding one grows the content without moving the view. */
const grownFrom = ref(2);
const grownTo = ref(4);
const growing = ref<InstanceType<typeof ZoomPane> | null>(null);
/** The pan and zoom specimen with a remembered view: save it, move around, put it back. */
const remembering = ref<InstanceType<typeof ZoomPane> | null>(null);
const savedView = ref<{ x: number; y: number; zoom: number }>();
function saveView() {
  const view = remembering.value?.view;
  if (view) savedView.value = { ...view };
}
/** The specimen with its own 100 %: its content is drawn at twice the size, so 100 % is the zoom 0.5. */
const doubled = ref<InstanceType<typeof ZoomPane> | null>(null);
/** A card (w-44) and the gap after it (gap-10). */
const STEP_WIDTH = 176 + 40;
function addInFront() {
  grownFrom.value--;
  // Everything moves one card to the right inside the content; the view follows so nothing jumps.
  growing.value?.moveOrigin(STEP_WIDTH, 0);
}
</script>

<template>
<DemoSection v-if="visible.has('zoom')" id="zoom" :title="title('zoom')" description="Drag to move, Ctrl + scroll or pinch to zoom, double-click to zoom in toward a point; in the corner: zoom out, the % (a click goes back to 100 %), zoom in, show the whole thing, and your own buttons. A plain scroll keeps scrolling the page, unless the pane fits only the width or wheel is zoom. With focus: + and - zoom, 0 shows the whole thing, arrow keys move.">
        <Specimen label="Wide content, starting at its right end when it doesn't fit at 60 %" column>
          <ZoomPane class="h-64" align="end" :fit-floor="0.6" label="Production line">
            <div class="flex items-center gap-10 p-4">
              <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
                <span class="font-medium">{{ step }}</span>
                <span class="text-muted-foreground text-xs">60 / min</span>
                <Button size="xs" variant="secondary" :disabled="off" @click="pressed = step">Pick</Button>
              </div>
            </div>
          </ZoomPane>
          <p class="text-muted-foreground text-xs">{{ pressed ? `Picked ${pressed}.` : "Buttons inside still work." }}</p>
        </Specimen>
        <Specimen label="auto-fit off: growing content keeps the view (fit only on first show or the button)" column>
          <ZoomPane ref="growing" class="h-64" :auto-fit="false" label="Growing line">
            <div class="flex items-center gap-10 p-4">
              <div v-for="step in STEPS.slice(grownFrom, grownTo)" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
                <span class="font-medium">{{ step }}</span>
                <span class="text-muted-foreground text-xs">60 / min</span>
              </div>
            </div>
          </ZoomPane>
          <div class="flex gap-2">
            <Button size="xs" variant="secondary" :disabled="off || grownFrom <= 0" @click="addInFront">Add a step in front (moveOrigin)</Button>
            <Button size="xs" variant="secondary" :disabled="off || grownTo >= STEPS.length" @click="grownTo++">Add a step after</Button>
          </div>
        </Specimen>
        <Specimen label="view, setView and showArea: remember a view, show a chosen area" column>
          <ZoomPane ref="remembering" class="h-64" label="Remembered line">
            <div class="flex items-center gap-10 p-4">
              <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
                <span class="font-medium">{{ step }}</span>
                <span class="text-muted-foreground text-xs">60 / min</span>
              </div>
            </div>
          </ZoomPane>
          <div class="flex gap-2">
            <Button size="xs" variant="secondary" :disabled="off" @click="saveView">Save this view</Button>
            <Button size="xs" variant="secondary" :disabled="off" @click="remembering?.showArea({ x: 0, y: 0, width: 200, height: 100 })">Show the top-left corner</Button>
            <Button size="xs" variant="secondary" :disabled="off || !savedView" @click="savedView && remembering?.setView(savedView)">Back to saved view</Button>
          </div>
        </Specimen>
        <Specimen label="hundred and extras: this content is drawn at twice the size, so its 100 % is the zoom 0.5; the buttons are one of your own after Whole map (wheel zooms, whole-label changes the hint)" column>
          <ZoomPane ref="doubled" class="h-64" :hundred="0.5" :min-zoom="0.1" :max-zoom="2" wheel="zoom" whole-label="Show the whole line" label="Large line">
            <div class="flex items-center gap-20 p-8">
              <div v-for="step in STEPS" :key="step" class="bg-card flex w-88 flex-none flex-col gap-4 rounded-lg border p-6 text-xl">
                <span class="font-medium">{{ step }}</span>
                <span class="text-muted-foreground text-base">60 / min</span>
              </div>
            </div>
            <template #extras>
              <Button variant="ghost" size="icon-sm" title="Show the first step" aria-label="Show the first step" :disabled="off" @click="doubled?.showArea({ x: 0, y: 0, width: 480, height: 240 })">
                <Focus />
              </Button>
            </template>
          </ZoomPane>
        </Specimen>
        <Specimen label="persist-key: the pane remembers its view in the module's storage; move it, reload the Playground and it opens where you left it" column>
          <ZoomPane class="h-64" persist-key="playground-line" label="Remembering line">
            <div class="flex items-center gap-10 p-4">
              <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
                <span class="font-medium">{{ step }}</span>
                <span class="text-muted-foreground text-xs">60 / min</span>
              </div>
            </div>
          </ZoomPane>
        </Specimen>
        <Specimen label="view-only: a canvas draws itself; the pane does the inputs, controls, glide and memory and sends the view (Whole map and the first-row button glide)" column>
          <ViewOnlyDemo :off="off" persist-key="playground-canvas" />
        </Specimen>
        <Specimen label="ZoomTip: the kit tooltip beside a box the game passes, for a canvas node with no element to hover (it opens above the node's box, never at the pointer)" column>
          <ViewOnlyDemo :off="off" tips />
        </Specimen>
        <Specimen label="Tall content with fit=&quot;width&quot;: fills the width, starts at the top, a plain scroll moves it" column>
          <ZoomPane class="h-64" fit="width" label="Production tree">
            <div class="flex w-[520px] flex-col items-center gap-6 p-4">
              <div v-for="step in [...STEPS].reverse()" :key="step" class="bg-card flex w-44 flex-col gap-1 rounded-lg border p-3">
                <span class="font-medium">{{ step }}</span>
                <span class="text-muted-foreground text-xs">60 / min</span>
              </div>
            </div>
          </ZoomPane>
        </Specimen>
      </DemoSection>
<DemoSection v-if="visible.has('map')" id="map" :title="title('map')" description="A map made of picture tiles with pins that keep their size: drag to move, scroll or pinch to zoom. Pins close together merge into a group with a count; dots (spawns) merge only among themselves. Give keyboards the same places as a list next to the map.">
        <Specimen label="Tiles per zoom level, pins with the pin slot, done, selected, highlight, showPins and a saved camera" column>
          <TileMapDemo :off="off" />
        </Specimen>
      </DemoSection>
</template>
