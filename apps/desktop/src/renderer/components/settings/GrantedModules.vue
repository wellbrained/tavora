<script setup lang="ts">
// The modules allowed to use something outside their panel (a connection, websites, stream overlays), each with Take
// back. Taking back removes everything the module was granted, as in the consent dialog; its data stays (decision
// log, module grants row of 2026-10-16). `testid` names the list: `<testid>-users`, `-user-<id>`, `-revoke-<id>`,
// and `-users-none` when no module may use it yet.
import { computed, ref } from "vue";
import { AnimatedList } from "@tavora/official-ui/components/ui/animated-list";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Tooltip, tooltipDelay } from "@tavora/official-ui/components/tooltip";
import type { ModuleConnector } from "../../../shared/host-api";
import type { MessageKey } from "../../../shared/i18n";
import { state } from "../../host";
import { t } from "../../i18n";
import { folderLabel, foldersOf } from "../../folder-label";
import ModuleIcon from "../ModuleIcon.vue";
import { siteGroups } from "../../site-groups";
import { revokeModule } from "./grants";

const props = defineProps<{
  /** The connector, "network" for the websites a module may reach, or "folders" for the folders it may read. */
  uses: ModuleConnector | "network" | "folders";
  /** A heading above the list. */
  heading?: string;
  /** Said when no module may use it yet. */
  none: string;
  /** The button's name for screen readers, with `{name}`. */
  revokeLabel: MessageKey;
  /** What the confirmation says for a module that no workspace uses, with `{name}`. */
  revokeUnused: MessageKey;
  testid: string;
}>();

const users = computed(() =>
  (state.value?.modules ?? []).filter((module) =>
    props.uses === "network"
      ? module.permissions.granted.network.length > 0
      : props.uses === "folders"
        ? module.permissions.granted.folders.length > 0
        : module.permissions.granted.connectors.includes(props.uses as ModuleConnector),
  ),
);

/** The full hosts behind the hovered or focused site chip, shown beside it. */
const tip = ref<{ hosts: string[]; anchor: { left: number; top: number; right: number; bottom: number } } | null>(null);
let delay: ReturnType<typeof setTimeout> | undefined;
function showHosts(event: Event, hosts: string[]) {
  const chip = event.currentTarget as HTMLElement;
  clearTimeout(delay);
  delay = setTimeout(() => {
    const { left, top, right, bottom } = chip.getBoundingClientRect();
    tip.value = { hosts, anchor: { left, top, right, bottom } };
  }, tooltipDelay(300));
}
function hideHosts() {
  clearTimeout(delay);
  tip.value = null;
}
</script>

<template>
  <div class="py-2">
    <p v-if="heading" class="text-muted-foreground pb-1 text-xs font-semibold">{{ heading }}</p>
    <p v-if="!users.length" class="text-muted-foreground py-1 text-sm" :data-testid="`${testid}-users-none`">{{ none }}</p>
    <AnimatedList tag="ul" v-else class="flex flex-col" :data-testid="`${testid}-users`">
      <li v-for="module in users" :key="module.id" class="flex items-center gap-3 border-b border-dashed py-2 last:border-b-0" :data-testid="`${testid}-user-${module.id}`">
        <span class="module-tile size-8" aria-hidden="true">
          <ModuleIcon :module-id="module.id" size="size-4" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="truncate font-medium">{{ module.name }}</span>
          <span v-if="uses === 'network'" class="flex flex-wrap gap-1">
            <!-- One chip per site; its tooltip lists the full hosts (granting always shows them in full). -->
            <code
              v-for="group in siteGroups(module.permissions.granted.network)"
              :key="group.site"
              tabindex="0"
              class="bg-muted rounded px-1.5 py-0.5 text-xs break-all"
              :aria-label="group.hosts.join(', ')"
              :data-testid="`${testid}-site-${module.id}-${group.site}`"
              @pointerenter="showHosts($event, group.hosts)"
              @pointerleave="hideHosts"
              @focus="showHosts($event, group.hosts)"
              @blur="hideHosts"
              >{{ group.site }}</code
            >
          </span>
          <span v-else-if="uses === 'folders'" class="flex flex-col gap-1">
            <span v-for="folder in foldersOf(module.permissions.granted.folders)" :key="folder.key" class="flex flex-wrap items-center gap-2">
              <code class="bg-muted rounded px-1.5 py-0.5 text-xs break-all">{{ folderLabel(folder) }}</code>
              <slot name="folder" :module="module" :folder="folder" />
            </span>
          </span>
        </span>
        <slot :module="module" />
        <Button variant="danger" size="sm" :aria-label="t(revokeLabel, { name: module.name })" :data-testid="`${testid}-revoke-${module.id}`" @click="revokeModule(module, revokeUnused)">
          {{ t("integrations.grants.revoke") }}
        </Button>
      </li>
    </AnimatedList>
    <Tooltip :open="tip !== null" :anchor="tip?.anchor" side="top" compact @dismiss="hideHosts">
      <span v-for="host in tip?.hosts ?? []" :key="host" class="block font-mono">{{ host }}</span>
    </Tooltip>
  </div>
</template>
