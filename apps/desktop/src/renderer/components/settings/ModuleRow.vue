<script setup lang="ts">
// One module in a Settings list: icon, name, version, who made it, what it
// does and where it was found (the Official badge says it for Tavora's own; a list
// that already says it, like a project folder's, hides it). The buttons for it go in the slot.
import { FolderCode, Package } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { state } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";

const props = defineProps<{ module: NonNullable<typeof state.value>["modules"][number]; hideOrigin?: boolean }>();
// A development folder holding a module with a publishable id (not local.…) is a release copy. Local and Release
// sit side by side in Settings > Development, so each has its own color and icon: blue for work in progress, green
// for the copy that gets published. Official keeps the gold.
const kind = computed(() =>
  props.module.provenance === "official" ? "official" : props.module.origin.kind === "dev" && !props.module.id.startsWith("local.") ? "release" : "local",
);
const tag = computed(() => t(`common.${kind.value}`));
const tagClass = {
  official: "border-primary/40 text-primary",
  release: "border-success/40 bg-success/15 text-success",
  local: "border-info/40 bg-info/15 text-info",
} as const;
</script>

<template>
  <li class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-4 last:border-b-0" :data-testid="`module-${module.id}`">
    <span class="bg-primary/10 border-primary/20 text-primary flex size-10 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
      <ModuleIcon :module-id="module.id" size="size-5" />
    </span>
    <div class="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate font-medium">{{ module.name }}</span>
        <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ module.version }}</span>
        <span
          :class="cn('inline-flex flex-none items-center gap-1 rounded-sm border px-1.5 text-xs font-medium', tagClass[kind])"
          :data-testid="`module-tag-${module.id}`"
          :data-kind="kind"
          ><Package v-if="kind === 'release'" class="size-3" aria-hidden="true" /><FolderCode v-else-if="kind === 'local'" class="size-3" aria-hidden="true" />{{ tag }}</span
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
      <span v-if="module.origin.kind !== 'official' && !hideOrigin" class="text-muted-foreground/80 text-xs" :data-testid="`module-origin-${module.id}`">{{ t(`modules.origin.${module.origin.kind}`, { folder: module.origin.folder }) }}</span>
    </div>
    <slot />
  </li>
</template>
