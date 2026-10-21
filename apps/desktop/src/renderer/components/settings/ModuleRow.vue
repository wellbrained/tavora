<script setup lang="ts">
// One module in a Settings list: icon, name, version, who made it, what it
// does and where it was found (the Official badge says it for Tavora's own). The buttons for it go in the slot.
import { cn } from "@/lib/utils";
import { state } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";

defineProps<{ module: NonNullable<typeof state.value>["modules"][number] }>();
</script>

<template>
  <li class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-4 last:border-b-0" :data-testid="`module-${module.id}`">
    <span class="bg-primary/10 border-primary/20 text-primary flex size-10 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
      <ModuleIcon :module-id="module.id" size="size-5" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate font-medium">{{ module.name }}</span>
        <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ module.version }}</span>
        <span
          :class="cn('flex-none rounded-sm border px-1.5 text-xs', module.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')"
          >{{ module.provenance === "official" ? t("common.official") : t("common.local") }}</span
        >
        <span
          v-if="module.publisher && module.publisherName"
          class="text-muted-foreground min-w-0 flex-none truncate rounded-sm border px-1.5 text-xs"
          :title="t('settings.modules.byNameHint', { name: module.publisherName, key: module.publisher })"
          :data-testid="`module-publisher-${module.id}`"
          >{{ t("settings.modules.byName", { name: module.publisherName }) }}</span
        >
        <span
          v-else-if="module.publisher"
          class="text-muted-foreground flex-none rounded-sm border px-1.5 font-mono text-xs"
          :title="t('settings.modules.publisherHint', { key: module.publisher })"
          :data-testid="`module-publisher-${module.id}`"
          >{{ t("settings.modules.publisher", { short: module.publisher.slice(0, 8) }) }}</span
        >
      </span>
      <span v-if="module.description" class="text-muted-foreground line-clamp-2 text-sm">{{ module.description }}</span>
      <span v-if="module.origin.kind !== 'official'" class="text-muted-foreground/80 text-xs" :data-testid="`module-origin-${module.id}`">{{ t(`modules.origin.${module.origin.kind}`, { folder: module.origin.folder }) }}</span>
    </div>
    <slot />
  </li>
</template>
