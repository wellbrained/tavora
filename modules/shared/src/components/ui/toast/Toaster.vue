<script setup lang="ts">
// Mount once per panel. Shows the toasts from useToast() along the bottom edge: normal ones in a
// polite live region, errors in an alert region, so screen readers announce each the right way.
import { computed } from "vue";
import ToastItem from "./ToastItem.vue";
import { toasts } from "./toast";

const normal = computed(() => toasts.value.filter((item) => item.variant !== "error"));
const errors = computed(() => toasts.value.filter((item) => item.variant === "error"));
</script>

<template>
  <div data-slot="toaster" class="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-2 px-3">
    <div role="status" aria-live="polite" class="flex w-full flex-col items-center gap-2">
      <ToastItem v-for="item in normal" :key="item.id" :item="item" />
    </div>
    <div role="alert" class="flex w-full flex-col items-center gap-2">
      <ToastItem v-for="item in errors" :key="item.id" :item="item" />
    </div>
  </div>
</template>
