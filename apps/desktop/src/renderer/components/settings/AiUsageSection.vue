<script setup lang="ts">
// Settings > Integrations > AI usage: the AI Usage connector. The Claude and Codex accounts, by
// the folder of the CLI profile that holds each login, and the modules allowed to read them, each
// revocable (decision log, module grants row of 2026-10-16). Logins stay in those folders; the main
// process reads them and none of it comes to this page or to a module.
import { computed, ref } from "vue";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import type { AiProvider, AiUsageAccount } from "../../../shared/host-api";
import { act, aiUsage, confirmAction, gamesUsing, listOf, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const view = computed(() => aiUsage.value);
const accounts = computed(() => view.value?.accounts ?? []);

// One form at a time: adding a new account, or editing one.
const editing = ref<string | "new" | null>(null);
const provider = ref<AiProvider>("claude");
const name = ref("");
const folder = ref("");
const busy = ref(false);

function startAdd() {
  editing.value = "new";
  provider.value = "claude";
  name.value = "";
  folder.value = "";
}
function startEdit(account: AiUsageAccount) {
  editing.value = account.id;
  provider.value = account.provider;
  name.value = account.label;
  folder.value = account.directory;
}
async function save() {
  if (busy.value || editing.value === null) return;
  busy.value = true;
  try {
    const result =
      editing.value === "new"
        ? await act({ type: "ai-usage-add", provider: provider.value, label: name.value, directory: folder.value })
        : await act({ type: "ai-usage-update", accountId: editing.value, label: name.value, directory: folder.value });
    if (result.ok) editing.value = null;
  } finally {
    busy.value = false;
  }
}

/** Where such a folder usually is on this system, as a hint in the empty field. */
const folderExample = computed(() => {
  const own = provider.value === "codex" ? ".codex" : ".claude";
  return navigator.platform.startsWith("Win") ? `C:\\Users\\…\\${own}` : `~/${own}`;
});

function removeAccount(account: AiUsageAccount) {
  confirmAction({
    title: t("aiUsage.settings.removeTitle", { name: account.label }),
    message: t("aiUsage.settings.removeNote"),
    confirm: t("aiUsage.settings.remove"),
    danger: true,
    run: () => submitAction({ type: "ai-usage-remove", accountId: account.id }),
  });
}

type ModuleView = NonNullable<typeof state.value>["modules"][number];

/** Modules the player allowed to read these accounts. */
const readers = computed(() => (state.value?.modules ?? []).filter((module) => module.permissions.granted.connectors.includes("ai-usage")));

function revoke(module: ModuleView) {
  const games = gamesUsing(module);
  confirmAction({
    title: t("integrations.grants.revokeTitle", { name: module.name }),
    message: games.length
      ? t("integrations.grants.revokeUsed", { name: module.name, games: listOf(games) })
      : t("integrations.aiUsage.revokeUnused", { name: module.name }),
    confirm: t("integrations.grants.revoke"),
    danger: true,
    run: () => submitAction({ type: "revoke-module", moduleId: module.id }),
  });
}
</script>

<template>
  <SettingGroup :title="t('integrations.aiUsage.title')" :description="t('aiUsage.settings.intro')">
    <SettingRow :label="t('settings.ai-usage-accounts.label')" :description="t('settings.ai-usage-accounts.description')" setting="ai-usage-accounts" :highlighted="highlight === 'ai-usage-accounts'">
      <Button variant="secondary" data-testid="ai-usage-add" :disabled="editing === 'new'" @click="startAdd">{{ t("aiUsage.settings.add") }}</Button>
    </SettingRow>

    <ul v-if="accounts.length || (view && editing !== 'new')" class="border-b" data-testid="ai-usage-accounts">
      <li v-for="account in accounts" :key="account.id" class="border-b py-2 last:border-b-0" :data-testid="`ai-usage-row-${account.id}`">
        <div v-if="editing !== account.id" class="flex items-center gap-3">
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium">{{ account.label }} <span class="text-muted-foreground font-normal">· {{ t(`aiUsage.provider.${account.provider}`) }}<template v-if="account.plan"> · {{ account.plan }}</template></span></span>
            <span class="text-muted-foreground truncate font-mono text-xs" :title="account.directory">{{ account.directory }}</span>
          </div>
          <Button variant="ghost" size="sm" data-testid="ai-usage-edit" @click="startEdit(account)">{{ t("aiUsage.settings.edit") }}</Button>
          <Button variant="danger" size="sm" data-testid="ai-usage-remove" @click="removeAccount(account)">{{ t("aiUsage.settings.remove") }}</Button>
        </div>
      </li>
      <li v-if="view && accounts.length === 0 && editing !== 'new'" class="text-muted-foreground py-3 text-sm" data-testid="ai-usage-none">{{ t("aiUsage.settings.empty") }}</li>
    </ul>

    <form v-if="editing !== null" class="my-3 flex flex-col gap-3 rounded-lg border p-3" data-testid="ai-usage-form" @submit.prevent="save">
      <SegmentedControl
        v-if="editing === 'new'"
        v-model="provider"
        :label="t('aiUsage.settings.add')"
        :options="[
          { value: 'claude', label: t('aiUsage.provider.claude'), testid: 'ai-usage-provider-claude' },
          { value: 'codex', label: t('aiUsage.provider.codex'), testid: 'ai-usage-provider-codex' },
        ]"
      />
      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium">{{ t("aiUsage.settings.name") }}</span>
        <Input v-model="name" maxlength="60" autocomplete="off" data-testid="ai-usage-name" />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium">{{ t("aiUsage.settings.folder") }}</span>
        <Input v-model="folder" maxlength="500" autocomplete="off" spellcheck="false" :placeholder="folderExample" data-testid="ai-usage-folder" />
      </label>
      <p class="text-muted-foreground text-xs">{{ t("aiUsage.settings.removeNote") }}</p>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" @click="editing = null">{{ t("aiUsage.settings.cancel") }}</Button>
        <Button type="submit" :disabled="busy || name.trim() === '' || folder.trim() === ''" data-testid="ai-usage-save">{{ t("aiUsage.settings.save") }}</Button>
      </div>
    </form>

    <div class="py-4">
      <p class="text-sm font-medium">{{ t("integrations.aiUsage.modules") }}</p>
      <p v-if="!readers.length" class="text-muted-foreground pt-1 text-sm" data-testid="ai-usage-readers-none">{{ t("integrations.aiUsage.noModules") }}</p>
      <ul v-else class="mt-1 flex flex-col" data-testid="ai-usage-readers">
        <li v-for="module in readers" :key="module.id" class="flex items-center gap-3 border-b py-2 last:border-b-0" :data-testid="`ai-usage-reader-${module.id}`">
          <span class="module-tile size-8" aria-hidden="true">
            <ModuleIcon :module-id="module.id" size="size-4" />
          </span>
          <span class="min-w-0 flex-1 truncate font-medium">{{ module.name }}</span>
          <Button
            variant="danger"
            :aria-label="t('integrations.aiUsage.revokeLabel', { name: module.name })"
            :data-testid="`ai-usage-revoke-${module.id}`"
            @click="revoke(module)"
          >
            {{ t("integrations.grants.revoke") }}
          </Button>
        </li>
      </ul>
    </div>
  </SettingGroup>
</template>
