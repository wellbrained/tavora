<script setup lang="ts">
// An icon tile: spins until its picture is there. The picture comes with the token (api.ts), shown from a blob address.
import { onMounted, ref, watch } from "vue";
import { picture } from "../api";

const props = defineProps<{ path: string }>();
const url = ref("");
const state = ref<"loading" | "ready" | "missing">("loading");

async function load(): Promise<void> {
  state.value = "loading";
  url.value = await picture(props.path);
  if (!url.value) state.value = "missing";
}

onMounted(load);
watch(() => props.path, load);
</script>

<template>
  <div class="bg-secondary flex size-11 items-center justify-center rounded-lg">
    <span v-if="state === 'loading'" class="border-muted-foreground/30 border-t-primary size-4 animate-spin rounded-full border-2 motion-reduce:animate-none" role="status" aria-label="Loading" />
    <img v-if="url" v-show="state === 'ready'" :src="url" alt="" class="size-9 rounded-md object-contain" @load="state = 'ready'" @error="state = 'missing'" />
    <span v-if="state === 'missing'" class="text-muted-foreground text-xs">none</span>
  </div>
</template>
