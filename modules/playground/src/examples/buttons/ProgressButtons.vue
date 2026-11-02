<script setup lang="ts">
import { Download } from "@lucide/vue";
import { ProgressButton, type ProgressButtonStatus } from "@tavora/official-ui/components/ui/progress-button";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
/** One that knows how far it is, one that doesn't. Each runs a pretend install when pressed. */
const known = ref<{ status: ProgressButtonStatus; progress: number }>({ status: "idle", progress: 0 });
const unknown = ref<ProgressButtonStatus>("idle");
function installKnown() {
  known.value = { status: "busy", progress: 0 };
  const timer = setInterval(() => {
    if (known.value.progress >= 100) {
      clearInterval(timer);
      known.value = { status: "done", progress: 100 };
      setTimeout(() => (known.value = { status: "idle", progress: 0 }), 1800);
    } else known.value = { status: "busy", progress: Math.min(100, known.value.progress + 7 + Math.round(Math.random() * 12)) };
  }, 250);
}
function installUnknown() {
  unknown.value = "busy";
  setTimeout(() => {
    unknown.value = "done";
    setTimeout(() => (unknown.value = "idle"), 1800);
  }, 2200);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <ProgressButton :status="known.status" :progress="known.progress" busy-label="Installing…" done-label="Installed" :disabled="off" @click="installKnown"><Download :stroke-width="1.5" /> Install</ProgressButton>
    <ProgressButton variant="secondary" :status="unknown" busy-label="Updating…" done-label="Updated" :disabled="off" @click="installUnknown">Update</ProgressButton>
  </div>
</template>
