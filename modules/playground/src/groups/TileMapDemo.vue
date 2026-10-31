<script setup lang="ts">
// The tile map specimen on a made-up world: its tiles are drawn here from the theme's colours (a real module serves
// game tiles), with an island so the levels line up visibly, and a grid with each tile's level and place.
import { Castle, Egg, Gem } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { type MapPin, TileMap, type TileSource } from "@tavora/official-ui/components/ui/tile-map";
import { computed, ref } from "vue";

defineProps<{ off: boolean }>();

const WORLD = 4096;
const TILE = 256;

/** The theme colours the tiles are drawn in, read when a tile is first drawn. */
function colours() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { sea: read("--muted"), land: read("--card"), shore: read("--border"), text: read("--muted-foreground") };
}

const drawn = new Map<string, string>();
/** One tile as a picture: sea, the part of the island on it, a frame and its level and place. */
function drawTile(level: number, x: number, y: number): string {
  const tint = colours();
  const key = `${level}/${x}/${y}/${tint.sea}/${tint.land}`;
  const cached = drawn.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE;
  const context = canvas.getContext("2d")!;
  const scale = TILE / (WORLD / 2 ** level);
  context.fillStyle = tint.sea;
  context.fillRect(0, 0, TILE, TILE);
  // The island, in world pixels, so it lines up at every level.
  context.save();
  context.scale(scale, scale);
  context.translate(-x * (WORLD / 2 ** level), -y * (WORLD / 2 ** level));
  context.beginPath();
  context.ellipse(WORLD * 0.48, WORLD * 0.52, WORLD * 0.36, WORLD * 0.28, -0.4, 0, Math.PI * 2);
  context.fillStyle = tint.land;
  context.fill();
  context.lineWidth = 12;
  context.strokeStyle = tint.shore;
  context.stroke();
  context.restore();
  context.strokeStyle = tint.shore;
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
  context.fillStyle = tint.text;
  context.font = "12px sans-serif";
  context.fillText(`level ${level} · ${x}, ${y}`, 8, 18);
  const url = canvas.toDataURL();
  drawn.set(key, url);
  return url;
}

const source: TileSource = { size: WORLD, tileSize: TILE, maxLevel: 4, url: drawTile };

/** A repeatable stream of numbers, so the pins land in the same places every time. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const KINDS = [
  { kind: "tower", label: "Tower" },
  { kind: "egg", label: "Egg" },
  { kind: "chest", label: "Chest" },
] as const;
type Kind = (typeof KINDS)[number]["kind"];
const ICONS = { tower: Castle, egg: Egg, chest: Gem };

const next = random(7);
const placed = Array.from({ length: 300 }, (_, index) => {
  const angle = next() * Math.PI * 2;
  const reach = Math.sqrt(next());
  const kind = KINDS[index % 3]!;
  return { id: `${kind.kind}-${index}`, kind: kind.kind as Kind, x: WORLD * 0.48 + Math.cos(angle) * reach * WORLD * 0.32, y: WORLD * 0.52 + Math.sin(angle) * reach * WORLD * 0.24, label: `${kind.label} ${index + 1}` };
});
const dots: MapPin[] = Array.from({ length: 120 }, (_, index) => {
  const x = WORLD * (0.3 + next() * 0.15);
  const y = WORLD * (0.35 + next() * 0.15);
  return { id: `spawn-${index}`, kind: "dot", x, y, label: `Spawn ${index + 1} (night)`, tone: index % 4 === 0 ? "warning" : "info" };
});

const done = ref(new Set(placed.filter((_, index) => index % 7 === 0).map((pin) => pin.id)));
const showDots = ref(true);
const showFog = ref(false);

/** The layer specimen: a fog over the whole map with the explored part (around the west) cleared, drawn small and stretched. */
let fogUrl = "";
function fog(): string {
  if (fogUrl) return fogUrl;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgb(0 0 0 / 0.6)";
  context.fillRect(0, 0, 256, 256);
  context.globalCompositeOperation = "destination-out";
  context.filter = "blur(8px)";
  context.beginPath();
  context.ellipse(256 * 0.36, 256 * 0.44, 256 * 0.2, 256 * 0.16, 0, 0, Math.PI * 2);
  context.fill();
  fogUrl = canvas.toDataURL();
  return fogUrl;
}
const highlightEggs = ref(false);
const selected = ref<string | null>(null);

const kindOf = new Map(placed.map((pin) => [pin.id, pin.kind]));
const pins = computed<MapPin[]>(() => [
  ...placed.map((pin) => ({ id: pin.id, x: pin.x, y: pin.y, label: pin.label, done: done.value.has(pin.id) })),
  ...(showDots.value ? dots : []),
]);
const eggs = placed.filter((pin) => pin.kind === "egg").map((pin) => pin.id);
const picked = computed(() => placed.find((pin) => pin.id === selected.value) ?? dots.find((pin) => pin.id === selected.value));

const map = ref<InstanceType<typeof TileMap> | null>(null);
const saved = ref<{ x: number; y: number; zoom: number }>();

function toggleDone() {
  if (!selected.value || !kindOf.has(selected.value)) return;
  const next = new Set(done.value);
  if (next.has(selected.value)) next.delete(selected.value);
  else next.add(selected.value);
  done.value = next;
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <TileMap ref="map" class="h-96" :source="source" :pins="pins" :selected="selected" :highlight="highlightEggs ? eggs : null" label="Made-up island" @select="selected = $event.id">
      <template #pin="{ pin }">
        <component :is="ICONS[kindOf.get(pin.id) ?? 'tower']" class="text-foreground size-5" :stroke-width="1.5" aria-hidden="true" />
      </template>
      <template v-if="showFog" #layer>
        <img :src="fog()" alt="" draggable="false" class="size-full max-w-none select-none">
      </template>
    </TileMap>
    <p class="text-muted-foreground text-xs">{{ picked ? `Picked ${picked.label}.` : "Click a pin to pick it; a group with a number zooms in." }}</p>
    <div class="flex flex-wrap gap-2">
      <Button size="xs" variant="secondary" :disabled="off || !selected || !kindOf.has(selected)" @click="toggleDone">Tick off the picked pin (done)</Button>
      <Button size="xs" variant="secondary" :disabled="off" @click="highlightEggs = !highlightEggs">{{ highlightEggs ? "Stop highlighting" : "Highlight the eggs (highlight)" }}</Button>
      <Button size="xs" variant="secondary" :disabled="off" @click="map?.showPins(eggs)">Show all eggs (showPins)</Button>
      <Button size="xs" variant="secondary" :disabled="off" @click="showDots = !showDots">{{ showDots ? "Hide the spawn dots" : "Show the spawn dots" }}</Button>
      <Button size="xs" variant="secondary" :disabled="off" @click="showFog = !showFog">{{ showFog ? "Hide the fog (layer)" : "Show a fog (layer)" }}</Button>
      <Button size="xs" variant="secondary" :disabled="off" @click="saved = map?.camera ? { ...map.camera } : undefined">Save this view (camera)</Button>
      <Button size="xs" variant="secondary" :disabled="off || !saved" @click="saved && map?.setCamera(saved)">Back to saved view (setCamera)</Button>
    </div>
  </div>
</template>
