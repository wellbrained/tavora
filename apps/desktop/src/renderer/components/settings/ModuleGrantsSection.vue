<script setup lang="ts">
// Settings > Modules > Website access: every module the player allowed to reach websites,
// with what it may reach, and taking that back (decision log, module grants row of 2026-10-16).
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cn } from "@/lib/utils";
import { confirmAction, workspacesUsing, listOf, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import SettingGroup from "./SettingGroup.vue";

defineProps<{ highlight: string | null }>();

type ModuleView = NonNullable<typeof state.value>["modules"][number];

const granted = computed(() => (state.value?.modules ?? []).filter((module) => module.permissions.granted.network.length > 0));

function revoke(module: ModuleView) {
  const workspaces = workspacesUsing(module);
  confirmAction({
    title: t("integrations.grants.revokeTitle", { name: module.name }),
    message: workspaces.length
      ? t("integrations.grants.revokeUsed", { name: module.name, workspaces: listOf(workspaces) })
      : t("integrations.grants.revokeUnused", { name: module.name }),
    confirm: t("integrations.grants.revoke"),
    danger: true,
    run: () => submitAction({ type: "revoke-module", moduleId: module.id }),
  });
}
</script>

<template>
  <SettingGroup :title="t('settings.module-grants.label')">
    <div
      :class="cn('-mx-5 border-b px-5 py-4 transition-colors duration-500 last:border-b-0', highlight === 'module-grants' && 'bg-primary/10')"
      data-setting="module-grants"
      :data-highlighted="highlight === 'module-grants' || undefined"
    >
      <p class="text-muted-foreground text-sm">{{ t("settings.module-grants.description") }}</p>
    </div>
    <p v-if="!granted.length" class="text-muted-foreground py-4 text-sm" data-testid="module-grants-empty">{{ t("integrations.grants.none") }}</p>
    <ul v-else class="flex flex-col" data-testid="module-grants">
      <li v-for="module in granted" :key="module.id" class="flex items-start gap-3 border-b py-3 last:border-b-0" :data-testid="`module-grant-${module.id}`">
        <span class="module-tile size-8" aria-hidden="true">
          <ModuleIcon :module-id="module.id" size="size-4" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="font-medium">{{ module.name }}</span>
          <span class="flex flex-wrap gap-1">
            <code v-for="host in module.permissions.granted.network" :key="host" class="bg-muted rounded px-1.5 py-0.5 text-xs break-all">{{ host }}</code>
          </span>
        </span>
        <Button
          variant="danger"
          :aria-label="t('integrations.grants.revokeLabel', { name: module.name })"
          :data-testid="`revoke-module-${module.id}`"
          @click="revoke(module)"
        >
          {{ t("integrations.grants.revoke") }}
        </Button>
      </li>
    </ul>
  </SettingGroup>
</template>
