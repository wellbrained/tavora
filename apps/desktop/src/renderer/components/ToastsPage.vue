<script setup lang="ts">
// The page of Tavora's own toasts, drawn above every panel (main/toast-view.ts). It is the kit's Toaster, the same as in a
// panel, in the theme and the place the main process sends. It tells the main process how big the stack is, so the page is
// only as big as the toasts, and reports a press on a toast's button or close button to the host page.
import { Toaster } from "@tavora/official-ui/components/ui/toast";
import { setUiLanguage } from "@tavora/official-ui/components/ui/text";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { TavoraToastsApi, ToastsPageState } from "../../shared/host-toasts";
import { mirrorToasts } from "../toast-mirror";

const api: TavoraToastsApi = window.tavoraToasts;
const state = ref<ToastsPageState>();

const presses = { action: (id: number) => api.action(id), dismiss: (id: number) => api.dismiss(id) };

function show(next: ToastsPageState): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(next.colors)) root.style.setProperty(`--${name}`, value);
  root.style.setProperty("--radius", `${next.radius}px`);
  root.style.setProperty("color-scheme", next.mode);
  root.classList.toggle("dark", next.mode === "dark");
  setUiLanguage(next.language);
  mirrorToasts(next.items, presses);
  state.value = next;
}

let last = "";
/** The stack's size, once per change. Nothing measured yet (no width) is not worth a message. */
function extent(size: { width: number; height: number }): void {
  const key = `${size.width}x${size.height}`;
  if (key === last) return;
  last = key;
  api.extent(size);
}

// A press moved the keys here; the main process gives them back to the page they came from.
const onClick = () => setTimeout(() => api.release(), 0);

onMounted(() => {
  api.onState(show);
  addEventListener("click", onClick, true);
  api.ready();
});
onBeforeUnmount(() => {
  removeEventListener("click", onClick, true);
});

const room = computed(() => `${state.value?.room ?? 0}px`);
</script>

<template>
  <!-- The toasts lay themselves out in a fixed room (the window's width, up to what one toast needs) whatever size this page
       has, centred on the page, or against its right edge; the page is the box of the stack and cuts the rest off. -->
  <Toaster
    v-if="state"
    :position="state.position"
    :paused="state.paused"
    :style="{ '--tavora-toast-room': room }"
    class="tavora-toasts-room"
    @extent="extent"
  />
</template>

<style>
.tavora-toaster.tavora-toasts-room {
  inset-inline: auto;
  width: var(--tavora-toast-room);
}
.tavora-toaster.tavora-toasts-room:not([data-position="bottom-right"]) {
  left: 50%;
  margin-left: calc(var(--tavora-toast-room) / -2);
}
.tavora-toaster.tavora-toasts-room[data-position="bottom-right"] {
  right: 0;
}
</style>
