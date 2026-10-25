<script setup lang="ts">
// A module project in a development folder that didn't load, laid out like a ModuleRow: a puzzle
// piece for its icon (its own can't be shown before it loads), the name and version its manifest
// gives (else the project folder's name), and what to do next. The buttons for it go in the slot.
import { CircleAlert } from "@lucide/vue";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";

defineProps<{ name: string; version: string | null; status: string }>();
</script>

<template>
  <li class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-4 last:border-b-0" data-testid="development-project">
    <span class="bg-primary/10 border-primary/20 text-primary flex size-10 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
      <ModuleIcon :module-id="undefined" size="size-[34px]" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate font-medium" data-testid="development-project-name">{{ name }}</span>
        <span v-if="version" class="text-muted-foreground flex-none text-xs tabular-nums">{{ version }}</span>
        <span class="text-muted-foreground flex-none rounded-sm border px-1.5 text-xs">{{ t("common.local") }}</span>
      </span>
      <span class="flex gap-1.5 text-sm">
        <CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
        <span data-testid="development-project-status">{{ status }}</span>
      </span>
    </div>
    <slot />
  </li>
</template>
