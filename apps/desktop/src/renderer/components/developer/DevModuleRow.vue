<script setup lang="ts">
// One of the developer's modules on Your modules, once, however many copies it has (dev-modules.ts). Closed it is
// one calm line: icon, name, version, where it stands in the catalog as words, a Publish button only when there is
// something to publish, and a menu for the rest. Opened it shows each copy's folder and, once the module is in the
// catalog, how users can reach the developer about it.
import { CircleCheck, Ellipsis, FileArchive, FolderOpen, Hourglass, Upload } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Contact, ModuleContact } from "../../../shared/conversations";
import { act, publishModule, saveModuleZip, showToast } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import ContactChoice from "./ContactChoice.vue";
import { waitsForPublish, type DevCopy, type DevModule } from "./dev-modules";

const props = defineProps<{ entry: DevModule; contact: ModuleContact | null; accounts: boolean; signedIn: boolean }>();
const open = defineModel<boolean>("open", { default: false });

const id = computed(() => props.entry.publishes.module.id);
/** Publish for what waits, and for a module that has only a local.… copy: its first publish gives it an id. */
const canPublish = computed(() => props.accounts && (waitsForPublish(props.entry) || (!props.entry.release && props.entry.status === null)));
const copies = computed(() =>
  [
    props.entry.local && { label: props.entry.release ? t("devModules.local") : t("devModules.folder"), copy: props.entry.local },
    props.entry.release && { label: props.entry.local ? t("devModules.release") : t("devModules.folder"), copy: props.entry.release },
  ].filter((line): line is { label: string; copy: DevCopy } => Boolean(line)),
);

const parts = (folder: string) => folder.split(/[\\/]/).filter(Boolean);
/** A long path shortened at its start, so the end, which tells folders apart, stays readable. */
function shortPath(folder: string): string {
  const all = parts(folder);
  if (all.length <= 3) return folder;
  const sep = folder.includes("\\") ? "\\" : "/";
  return `…${sep}${all.slice(-2).join(sep)}`;
}

const openProject = (project: string) => act({ type: "open-development-project", project });

async function saveContact(contact: Contact): Promise<string | null> {
  const result = await act({ type: "inbox-contact", moduleId: id.value, ...contact }, { quiet: true });
  if (!result.ok) return result.error;
  showToast(t("contactChoice.saved"));
  return null;
}
</script>

<template>
  <Collapsible v-model:open="open" as="li" class="border-b last:border-b-0" :data-testid="`dev-module-${id}`" :data-status="entry.status ?? undefined">
    <div :class="cn('-mx-5 flex items-center gap-3 px-5 py-2', open && 'bg-muted/40')">
      <CollapsibleTrigger class="min-w-0 flex-1 gap-3 py-1 font-normal" :aria-label="t('devModules.details', { name: entry.name })" :data-testid="`dev-module-toggle-${id}`">
        <span class="module-tile size-8" aria-hidden="true">
          <ModuleIcon :module-id="id" size="size-[26px]" />
        </span>
        <span class="truncate font-medium">{{ entry.name }}</span>
        <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ (entry.local ?? entry.publishes).module.version }}</span>
      </CollapsibleTrigger>

      <span
        v-if="entry.status === 'in-review'"
        class="text-info flex flex-none items-center gap-1.5 text-sm"
        :title="t('release.inReviewHint')"
        :data-testid="`module-pending-${id}`"
        data-status="in-review"
        ><Hourglass class="size-4" :stroke-width="1.5" aria-hidden="true" />{{ t("release.inReview") }}</span
      >
      <span v-else-if="waitsForPublish(entry)" class="text-warning flex flex-none items-center gap-1.5 text-sm" :data-testid="`module-pending-${id}`" :data-status="entry.status"
        ><Upload class="size-4" :stroke-width="1.5" aria-hidden="true" />{{ entry.status === "new-version" ? t("release.newVersion") : t("release.notPublished") }}</span
      >
      <span v-else-if="entry.status === 'current'" class="text-muted-foreground flex flex-none items-center gap-1.5 text-sm" :data-testid="`module-published-${id}`"
        ><CircleCheck class="size-4" :stroke-width="1.5" aria-hidden="true" />{{ t("release.published") }}</span
      >

      <!-- A fixed slot, so the statuses line up whether a row has Publish or not. -->
      <span v-if="accounts" class="flex w-28 flex-none justify-end">
        <Button v-if="canPublish" :variant="waitsForPublish(entry) ? 'default' : 'secondary'" :data-testid="`publish-${id}`" @click="publishModule(id)">
          <Upload :stroke-width="1.5" /> {{ t("publish.button") }}
        </Button>
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" class="flex-none" :aria-label="t('devModules.more', { name: entry.name })" :title="t('common.more')" :data-testid="`dev-module-more-${id}`">
            <Ellipsis :stroke-width="1.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem :data-testid="`open-project-${id}`" @select="openProject(entry.publishes.project)">
            <FolderOpen aria-hidden="true" /> {{ t("common.openFolder") }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="accounts" :data-testid="`save-zip-${id}`" @select="saveModuleZip(id)">
            <FileArchive aria-hidden="true" /> {{ t("publish.saveZip") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <CollapsibleContent class="bg-muted/40 -mx-5 flex flex-col px-5 pb-4 pl-[92px]" :data-testid="`dev-module-details-${id}`">
      <div v-for="line in copies" :key="line.copy.module.id" class="flex min-h-10 items-center gap-3 text-sm" :data-testid="`dev-copy-${line.copy.module.id}`">
        <span class="text-muted-foreground w-24 flex-none">{{ line.label }}</span>
        <span class="min-w-0 flex-1 truncate font-mono text-xs" :title="line.copy.project">{{ shortPath(line.copy.project) }}</span>
        <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ line.copy.module.version }}</span>
        <Button variant="ghost" size="sm" class="flex-none" :data-testid="`open-copy-${line.copy.module.id}`" @click="openProject(line.copy.project)">
          <FolderOpen :stroke-width="1.5" /> {{ t("common.openFolder") }}
        </Button>
      </div>

      <template v-if="signedIn">
        <div class="my-2 border-t" />
        <ContactChoice v-if="contact" :contact="contact" :name="entry.name" :save="saveContact" :testid="`contact-${id}`">
          <template #label>
            <span class="font-medium">{{ t("contactChoice.title") }}</span>
            <span class="text-muted-foreground text-sm">{{ t("contactChoice.where", { name: entry.name }) }}</span>
          </template>
        </ContactChoice>
        <p v-else class="text-muted-foreground py-1 text-sm" :data-testid="`contact-later-${id}`">{{ t("contactChoice.later", { name: entry.name }) }}</p>
      </template>
    </CollapsibleContent>
  </Collapsible>
</template>
