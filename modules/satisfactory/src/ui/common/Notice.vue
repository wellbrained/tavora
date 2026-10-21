<script setup lang="ts">
// One line at the top centre of the panel, gone after a few seconds.
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { onBeforeUnmount, onMounted } from "vue";
import { t } from "../../i18n";

const DURATION_MS = 6_000;

defineProps<{ message: string }>();
const emit = defineEmits<{ dismiss: [] }>();

let timer: ReturnType<typeof setTimeout> | undefined;
onMounted(() => (timer = setTimeout(() => emit("dismiss"), DURATION_MS)));
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div
    class="bg-popover text-popover-foreground absolute top-12 left-1/2 z-50 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3 text-sm shadow-lg"
    role="status"
    aria-live="polite"
    data-testid="notice"
  >
    <span class="min-w-0">{{ message }}</span>
    <Button size="icon-sm" variant="ghost" class="flex-none" :aria-label="t('dismiss')" :title="t('dismiss')" @click="emit('dismiss')">
      <X :stroke-width="1.5" />
    </Button>
  </div>
</template>
