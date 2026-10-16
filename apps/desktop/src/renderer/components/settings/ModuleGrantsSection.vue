<script setup lang="ts">
// Settings > Integrations > Websites for modules: every module the player allowed to reach websites,
// with what it may reach, and taking that back (decisions.md, module grants row of 2026-10-16).
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { confirmAction, gamesUsing, listOf, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

type ModuleView = NonNullable<typeof state.value>["modules"][number];

const granted = computed(() => (state.value?.modules ?? []).filter((module) => module.permissions.granted.network.length > 0));

function revoke(module: ModuleView) {
  const games = gamesUsing(module);
  confirmAction({
    title: t("integrations.grants.revokeTitle", { name: module.name }),
    message: games.length
      ? t("integrations.grants.revokeUsed", { name: module.name, games: listOf(games) })
      : t("integrations.grants.revokeUnused", { name: module.name }),
    confirm: t("integrations.grants.revoke"),
    danger: true,
    run: () => submitAction({ type: "revoke-module", moduleId: module.id }),
  });
}
</script>

<template>
  <section>
    <h3 class="text-lg font-semibold">{{ t("integrations.grants.title") }}</h3>
    <SettingRow
      class="mt-2"
      :label="t('settings.module-grants.label')"
      :description="t('settings.module-grants.description')"
      setting="module-grants"
      :highlighted="highlight === 'module-grants'"
    />
    <p v-if="!granted.length" class="text-muted-foreground py-2" data-testid="module-grants-empty">{{ t("integrations.grants.none") }}</p>
    <ul v-else class="flex flex-col" data-testid="module-grants">
      <li v-for="module in granted" :key="module.id" class="flex items-start gap-3 border-b py-3 last:border-b-0" :data-testid="`module-grant-${module.id}`">
        <span class="bg-background text-primary flex size-8 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
          <ModuleIcon :module-id="module.id" size="size-4" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="font-medium">{{ module.name }}</span>
          <span class="text-muted-foreground text-sm">{{ t("integrations.grants.reaches") }}</span>
          <span class="flex flex-wrap gap-1">
            <code v-for="host in module.permissions.granted.network" :key="host" class="bg-muted rounded px-1.5 py-0.5 text-xs break-all">{{ host }}</code>
          </span>
        </span>
        <Button
          variant="secondary"
          :aria-label="t('integrations.grants.revokeLabel', { name: module.name })"
          :data-testid="`revoke-module-${module.id}`"
          @click="revoke(module)"
        >
          {{ t("integrations.grants.revoke") }}
        </Button>
      </li>
    </ul>
  </section>
</template>
