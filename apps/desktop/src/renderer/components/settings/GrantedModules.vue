<script setup lang="ts">
// The modules allowed to use something outside their panel (a connection, websites, stream overlays), each with Take
// back. Taking back removes everything the module was granted, as in the consent dialog; its data stays (decision
// log, module grants row of 2026-10-16). `testid` names the list: `<testid>-users`, `-user-<id>`, `-revoke-<id>`,
// and `-users-none` when no module may use it yet.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { ModuleConnector } from "../../../shared/host-api";
import type { MessageKey } from "../../../shared/i18n";
import { state } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import { revokeModule } from "./grants";

const props = defineProps<{
  /** The connector, or "network" for the websites a module may reach. */
  uses: ModuleConnector | "network";
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
    props.uses === "network" ? module.permissions.granted.network.length > 0 : module.permissions.granted.connectors.includes(props.uses as ModuleConnector),
  ),
);
</script>

<template>
  <div class="py-2">
    <p v-if="heading" class="text-muted-foreground pb-1 text-xs font-semibold">{{ heading }}</p>
    <p v-if="!users.length" class="text-muted-foreground py-1 text-sm" :data-testid="`${testid}-users-none`">{{ none }}</p>
    <ul v-else class="flex flex-col" :data-testid="`${testid}-users`">
      <li v-for="module in users" :key="module.id" class="flex items-center gap-3 border-b border-dashed py-2 last:border-b-0" :data-testid="`${testid}-user-${module.id}`">
        <span class="module-tile size-8" aria-hidden="true">
          <ModuleIcon :module-id="module.id" size="size-4" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="truncate font-medium">{{ module.name }}</span>
          <span v-if="uses === 'network'" class="flex flex-wrap gap-1">
            <code v-for="host in module.permissions.granted.network" :key="host" class="bg-muted rounded px-1.5 py-0.5 text-xs break-all">{{ host }}</code>
          </span>
        </span>
        <slot :module="module" />
        <Button variant="danger" size="sm" :aria-label="t(revokeLabel, { name: module.name })" :data-testid="`${testid}-revoke-${module.id}`" @click="revokeModule(module, revokeUnused)">
          {{ t("integrations.grants.revoke") }}
        </Button>
      </li>
    </ul>
  </div>
</template>
