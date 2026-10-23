<script setup lang="ts">
// One line at the top centre of the panel, gone after a few seconds. It can
// carry one action, such as Undo, which also closes it.
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { onBeforeUnmount, onMounted } from "vue";
import { t } from "../../i18n";
import type { NoticeAction } from "../context";

const DURATION_MS = 6_000;

const props = defineProps<{ message: string; action?: NoticeAction }>();
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
    <Button v-if="action" size="sm" variant="ghost" class="flex-none" data-testid="notice-action" @click="props.action!.run(), emit('dismiss')">{{ action.label }}</Button>
    <Button size="icon-sm" variant="ghost" class="flex-none" :aria-label="t('dismiss')" :title="t('dismiss')" @click="emit('dismiss')">
      <X :stroke-width="1.5" />
    </Button>
  </div>
</template>
