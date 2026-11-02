<script setup lang="ts">
// One button that knows how far it is, one that doesn't. Each runs a pretend install when pressed.
import { Download } from "@lucide/vue";
import { ProgressButton, type ProgressButtonStatus } from "@tavora/official-ui/components/ui/progress-button";
import { onBeforeUnmount, ref } from "vue";

defineProps<{ disabled?: boolean }>();

const known = ref<{ status: ProgressButtonStatus; progress: number }>({ status: "idle", progress: 0 });
const unknown = ref<ProgressButtonStatus>("idle");
const timers = new Set<ReturnType<typeof setTimeout>>();
const later = (fn: () => void, ms: number) => timers.add(setTimeout(fn, ms));

function installKnown() {
  known.value = { status: "busy", progress: 0 };
  const timer = setInterval(() => {
    if (known.value.progress >= 100) {
      clearInterval(timer);
      known.value = { status: "done", progress: 100 };
      later(() => (known.value = { status: "idle", progress: 0 }), 1800);
    } else known.value = { status: "busy", progress: Math.min(100, known.value.progress + 7 + Math.round(Math.random() * 12)) };
  }, 250);
  timers.add(timer);
}
function installUnknown() {
  unknown.value = "busy";
  later(() => {
    unknown.value = "done";
    later(() => (unknown.value = "idle"), 1800);
  }, 2200);
}
onBeforeUnmount(() => timers.forEach((timer) => clearInterval(timer)));
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <ProgressButton :status="known.status" :progress="known.progress" busy-label="Installing…" done-label="Installed" :disabled="disabled" @click="installKnown"><Download :stroke-width="1.5" /> Install</ProgressButton>
    <ProgressButton variant="secondary" :status="unknown" busy-label="Updating…" done-label="Updated" :disabled="disabled" @click="installUnknown">Update</ProgressButton>
  </div>
</template>
