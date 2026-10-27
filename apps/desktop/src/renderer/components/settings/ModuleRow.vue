<script setup lang="ts">
// One module in a Settings list: icon, name, version, who made it, what it
// does and where it was found (the Official badge says it for Tavora's own; a list
// that already says it, like a project folder's, hides it). The buttons for it go in the slot.
import { FileArchive, FolderCode, Hourglass, Package, Store, Upload } from "@lucide/vue";
import { computed } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { cn } from "@/lib/utils";
import { releaseStatus, state } from "../../host";
import { t } from "../../i18n";
import { MODULE_TAG_TEXT, moduleTag } from "../../../shared/module-tag";
import ModuleIcon from "../ModuleIcon.vue";

const props = defineProps<{ module: NonNullable<typeof state.value>["modules"][number]; hideOrigin?: boolean }>();
// Where this copy came from (shared/module-tag.ts). Local and Release sit side by side in Settings > Development,
// so each has its own color and icon: blue for work in progress, green for the copy that gets published. Official
// keeps the gold; Catalog and From file, what users install, stay quiet.
const kind = computed(() => moduleTag(props.module));
// A release copy that the catalog does not have yet, or has only in an older version, says so; unknown (offline) says nothing.
// One whose version was published and waits for a person at Tavora says In review instead.
const pending = computed(() => {
  const status = kind.value === "release" ? releaseStatus.value?.[props.module.id] : undefined;
  return status === "new-version" || status === "not-published" || status === "in-review" ? status : null;
});
const tag = computed(() => t(MODULE_TAG_TEXT[kind.value]));
const tagClass = {
  official: "border-primary/40 text-primary",
  release: "border-success/40 bg-success/15 text-success",
  local: "border-info/40 bg-info/15 text-info",
  catalog: "text-muted-foreground",
  file: "text-muted-foreground",
  example: "text-muted-foreground",
} as const;
</script>

<template>
  <li class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-4 last:border-b-0" :data-testid="`module-${module.id}`">
    <span class="module-tile size-10" aria-hidden="true">
      <ModuleIcon :module-id="module.id" size="size-[34px]" />
    </span>
    <div class="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate font-medium">{{ module.name }}</span>
        <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ module.version }}</span>
        <Badge variant="outline" :class="cn('py-0', tagClass[kind])" :data-testid="`module-tag-${module.id}`" :data-kind="kind">
          <Package v-if="kind === 'release'" aria-hidden="true" />
          <FolderCode v-else-if="kind === 'local'" aria-hidden="true" />
          <Store v-else-if="kind === 'catalog'" aria-hidden="true" />
          <FileArchive v-else-if="kind === 'file'" aria-hidden="true" />{{ tag }}
        </Badge>
        <Badge
          v-if="pending === 'in-review'"
          variant="info"
          class="border-info/40 py-0"
          :title="t('release.inReviewHint')"
          :data-testid="`module-pending-${module.id}`"
          data-status="in-review"
        >
          <Hourglass aria-hidden="true" />{{ t("release.inReview") }}
        </Badge>
        <Badge v-else-if="pending" variant="warning" class="border-warning/40 py-0" :data-testid="`module-pending-${module.id}`" :data-status="pending">
          <Upload aria-hidden="true" />{{ pending === "new-version" ? t("release.newVersion") : t("release.notPublished") }}
        </Badge>
        <Badge
          v-if="module.publisher && module.publisherName"
          variant="outline"
          class="text-muted-foreground block min-w-0 truncate py-0 font-normal"
          :title="t('settings.modules.byNameHint', { name: module.publisherName, key: module.publisher })"
          :data-testid="`module-publisher-${module.id}`"
          >{{ t("settings.modules.byName", { name: module.publisherName }) }}</Badge
        >
        <Badge
          v-else-if="module.publisher"
          variant="outline"
          class="text-muted-foreground py-0 font-mono font-normal"
          :title="t('settings.modules.publisherHint', { key: module.publisher })"
          :data-testid="`module-publisher-${module.id}`"
          >{{ t("settings.modules.publisher", { short: module.publisher.slice(0, 8) }) }}</Badge
        >
      </span>
      <span v-if="module.description" class="text-muted-foreground line-clamp-2 text-sm">{{ module.description }}</span>
      <span v-if="module.origin.kind !== 'official' && !hideOrigin" class="text-muted-foreground/80 text-xs" :data-testid="`module-origin-${module.id}`">{{ t(`modules.origin.${module.origin.kind}`, { folder: module.origin.folder }) }}</span>
    </div>
    <slot />
  </li>
</template>
