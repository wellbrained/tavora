<script setup lang="ts">
// Settings > Integrations > AI usage: the Claude and Codex accounts the AI
// Usage panel shows, by the folder of the CLI profile that holds each login,
// and how often the panel reads them. Logins stay in those folders; the main
// process reads them and none of it comes to this page.
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiProvider, AiUsageAccount, AiUsageStyle } from "../../../shared/host-api";
import { act, aiUsage } from "../../host";
import { t } from "../../i18n";
import SegmentedControl from "./SegmentedControl.vue";
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

const style = computed<AiUsageStyle>({
  get: () => view.value?.style ?? "remaining",
  set: (value) => void act({ type: "ai-usage-set-style", style: value }),
});

const INTERVALS =[1, 5, 15, 30, 60];
const intervalOptions = computed(() => INTERVALS.map((minutes) => ({ value: String(minutes), label: t("aiUsage.settings.every", { minutes }), testid: `ai-usage-every-${minutes}` })));
const interval = computed({
  get: () => String(view.value?.refreshMinutes ?? 5),
  set: (value: string) => void act({ type: "ai-usage-set-interval", minutes: Number(value) }),
});
</script>

<template>
  <section>
    <h3 class="text-lg font-semibold">{{ t("integrations.aiUsage.title") }}</h3>
    <p class="text-muted-foreground mt-1 mb-4">{{ t("aiUsage.settings.intro") }}</p>

    <SettingRow :label="t('settings.ai-usage-accounts.label')" :description="t('settings.ai-usage-accounts.description')" setting="ai-usage-accounts" :highlighted="highlight === 'ai-usage-accounts'">
      <Button variant="secondary" data-testid="ai-usage-add" :disabled="editing === 'new'" @click="startAdd">{{ t("aiUsage.settings.add") }}</Button>
    </SettingRow>

    <ul class="mt-1" data-testid="ai-usage-accounts">
      <li v-for="account in accounts" :key="account.id" class="border-b py-2 last:border-b-0" :data-testid="`ai-usage-row-${account.id}`">
        <div v-if="editing !== account.id" class="flex items-center gap-3">
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium">{{ account.label }} <span class="text-muted-foreground font-normal">· {{ t(`aiUsage.provider.${account.provider}`) }}<template v-if="account.plan"> · {{ account.plan }}</template></span></span>
            <span class="text-muted-foreground truncate text-sm" :title="account.directory">{{ account.directory }}</span>
          </div>
          <Button variant="ghost" size="sm" data-testid="ai-usage-edit" @click="startEdit(account)">{{ t("aiUsage.settings.edit") }}</Button>
          <Button variant="ghost" size="sm" data-testid="ai-usage-remove" @click="act({ type: 'ai-usage-remove', accountId: account.id })">{{ t("aiUsage.settings.remove") }}</Button>
        </div>
      </li>
      <li v-if="view && accounts.length === 0 && editing !== 'new'" class="text-muted-foreground py-3 text-sm" data-testid="ai-usage-none">{{ t("aiUsage.settings.empty") }}</li>
    </ul>

    <form v-if="editing !== null" class="mt-2 flex flex-col gap-3 rounded-lg border p-3" data-testid="ai-usage-form" @submit.prevent="save">
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
        <Input v-model="folder" maxlength="500" autocomplete="off" spellcheck="false" placeholder="C:\Users\you\.claude" data-testid="ai-usage-folder" />
      </label>
      <p class="text-muted-foreground text-xs">{{ t("aiUsage.settings.removeNote") }}</p>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost" @click="editing = null">{{ t("aiUsage.settings.cancel") }}</Button>
        <Button type="submit" :disabled="busy || name.trim() === '' || folder.trim() === ''" data-testid="ai-usage-save">{{ t("aiUsage.settings.save") }}</Button>
      </div>
    </form>

    <SettingRow class="mt-2" :label="t('settings.ai-usage-style.label')" :description="t('settings.ai-usage-style.description')" setting="ai-usage-style" :highlighted="highlight === 'ai-usage-style'">
      <SegmentedControl
        v-model="style"
        :label="t('settings.ai-usage-style.label')"
        :options="[
          { value: 'remaining', label: t('aiUsage.settings.styleRemaining'), testid: 'ai-usage-style-remaining' },
          { value: 'used', label: t('aiUsage.settings.styleUsed'), testid: 'ai-usage-style-used' },
        ]"
      />
    </SettingRow>

    <SettingRow :label="t('settings.ai-usage-interval.label')" :description="t('settings.ai-usage-interval.description')" setting="ai-usage-interval" :highlighted="highlight === 'ai-usage-interval'">
      <SegmentedControl v-model="interval" :label="t('settings.ai-usage-interval.label')" :options="intervalOptions" />
    </SettingRow>
  </section>
</template>
