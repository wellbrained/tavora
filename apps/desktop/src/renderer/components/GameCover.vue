<script setup lang="ts">
// A game's tall cover in the Add a game picker: Steam's own cover art from this PC, else the game's tile in the middle
// of a cover in the game's colour. While the game is being added a spinner sits on it. Presentational, like GameTile.
import { Loader } from "@lucide/vue";
import { computed } from "vue";
import { FadeImage } from "@tavora/official-ui/components/ui/fade-image";
import { badgeLook } from "../badge";
import GameTile from "./GameTile.vue";

const props = defineProps<{
  id: string;
  name: string;
  icon: string | null;
  /** The cover art's address, null for none, undefined while it is looked for. */
  cover: string | null | undefined;
  busy?: boolean;
}>();
const look = computed(() => badgeLook(props.id));
</script>

<template>
  <span class="relative block aspect-[2/3] w-full overflow-hidden rounded-lg" aria-hidden="true">
    <FadeImage class="size-full" :src="cover ?? null" :pending="cover === undefined" alt="" draggable="false">
      <template #fallback>
        <span class="grid size-full place-items-center" :style="{ backgroundColor: look.color, backgroundImage: look.image, backgroundSize: look.size }">
          <GameTile :id="id" :name="name" :icon="icon" :size="56" />
        </span>
      </template>
    </FadeImage>
    <span v-if="busy" class="bg-background/60 absolute inset-0 grid place-items-center">
      <Loader class="size-6 animate-spin motion-reduce:animate-none" :stroke-width="1.75" />
    </span>
  </span>
</template>
