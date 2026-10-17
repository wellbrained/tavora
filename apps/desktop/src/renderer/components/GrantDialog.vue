<script setup lang="ts">
// The consent dialog (decision log, module grants row of 2026-10-16): what a module asks for that the
// player has not granted, shown when the module is first added or when an update asks for more.
// Tavora draws it, never the module, so a module cannot fake or hide what it asks for. A connector
// shows what the module would read through it: for AI Usage, the accounts set up right now; for
// Discord, what it can see and do in the Discord app, with Tavora's sign-in.
import { Gauge, Globe, Headphones } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { act, aiUsage, dialog, discord, nextPanelSlot, openSettings, state, type GrantRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";
import ModuleIcon from "./ModuleIcon.vue";

const props = defineProps<{ request: GrantRequest }>();
const error = ref<string | null>(null);
const busy = ref(false);

const module = computed(() => state.value?.modules.find((item) => item.id === props.request.moduleId) ?? null);
const hosts = computed(() => module.value?.permissions.missing.network ?? []);
const connectors = computed(() => module.value?.permissions.missing.connectors ?? []);
const aiAccounts = computed(() => aiUsage.value?.accounts ?? []);
const discordUser = computed(() => discord.value?.user ?? null);

// The module went away, or has nothing left to ask: nothing to answer.
watch(
  [module, hosts, connectors],
  () => {
    if (!busy.value && (!module.value || hosts.value.length + connectors.value.length === 0)) dialog.value = null;
  },
  { immediate: true },
);

const from = computed(() => {
  const current = module.value;
  if (!current) return "";
  if (current.publisher && current.publisherName) return t("grant.from.publisherName", { name: current.publisherName, key: current.publisher.slice(0, 8) });
  if (current.publisher) return t("grant.from.publisher", { key: current.publisher.slice(0, 8) });
  return current.provenance === "official" ? t("grant.from.official") : t("grant.from.local");
});

/** The accounts are chosen in Settings; the dialog closes so the page is not behind it. */
function editAccounts() {
  dialog.value = null;
  openSettings({ section: "integrations", setting: "ai-usage-accounts" });
}

async function allow() {
  const current = module.value;
  if (!current) return;
  busy.value = true;
  // Exactly what this dialog shows: the main process grants only what the module still asks for.
  const result = await act({ type: "grant-module", moduleId: current.id, network: [...hosts.value], connectors: [...connectors.value] }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  dialog.value = null;
  if (props.request.review) return;
  nextPanelSlot.value = props.request.slot;
  const { panelType } = props.request;
  void act({ type: "open-module", moduleId: current.id, ...(panelType ? { panelType } : {}) });
}
</script>

<template>
  <ModalDialog
    v-if="module"
    :title="request.review ? t('grant.reviewTitle', { name: module.name }) : t('grant.title', { name: module.name })"
    class="sm:max-w-[480px]"
    testid="grant-dialog"
    @close="dialog = null"
  >
    <div class="flex items-center gap-3">
      <span class="bg-background text-primary flex size-10 flex-none items-center justify-center rounded-[10px] border" aria-hidden="true">
        <ModuleIcon :module-id="module.id" size="size-5" />
      </span>
      <span class="text-muted-foreground text-sm" data-testid="grant-from">{{ from }}</span>
    </div>
    <section v-if="connectors.includes('ai-usage')" class="flex flex-col gap-2" :aria-label="t('grant.aiUsage')" data-testid="grant-ai-usage">
      <h3 class="flex items-center gap-2 font-medium"><Gauge :stroke-width="1.5" class="size-4" /> {{ t("grant.aiUsage") }}</h3>
      <ul v-if="aiAccounts.length" class="bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-sm" data-testid="grant-ai-accounts">
        <li v-for="account in aiAccounts" :key="account.id" class="truncate">
          {{ account.label }} <span class="text-muted-foreground">· {{ t(`aiUsage.provider.${account.provider}`) }}</span>
        </li>
      </ul>
      <p v-else class="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">{{ t("grant.aiUsageNone") }}</p>
      <p class="text-muted-foreground text-sm">
        {{ t("grant.aiUsageNote") }}
        <button type="button" class="text-foreground underline underline-offset-2" @click="editAccounts">{{ t("grant.aiUsageAccounts") }}</button>
      </p>
    </section>
    <section v-if="connectors.includes('discord')" class="flex flex-col gap-2" :aria-label="t('grant.discord')" data-testid="grant-discord">
      <h3 class="flex items-center gap-2 font-medium"><Headphones :stroke-width="1.5" class="size-4" /> {{ t("grant.discord") }}</h3>
      <ul class="bg-muted flex list-disc flex-col gap-1 rounded-md py-2 pr-3 pl-7 text-sm" data-testid="grant-discord-can">
        <li>{{ t("grant.discordRead") }}</li>
        <li>{{ t("grant.discordJoin") }}</li>
        <li>{{ t("grant.discordVoice") }}</li>
      </ul>
      <p class="text-muted-foreground text-sm">
        {{ discordUser ? t("grant.discordAs", { name: discordUser.name }) : t("grant.discordSignIn") }}
        {{ t("grant.discordNote") }}
      </p>
    </section>
    <section v-if="hosts.length" class="flex flex-col gap-2" :aria-label="t('grant.network')">
      <h3 class="flex items-center gap-2 font-medium"><Globe :stroke-width="1.5" class="size-4" /> {{ t("grant.network") }}</h3>
      <ul class="bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-sm" data-testid="grant-hosts">
        <li v-for="host in hosts" :key="host" class="font-mono break-all">{{ host }}</li>
      </ul>
      <p class="text-muted-foreground text-sm">{{ t("grant.networkNote") }}</p>
    </section>
    <p class="text-muted-foreground text-sm">{{ t("grant.later") }}</p>
    <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="secondary" autofocus data-testid="grant-cancel" @click="dialog = null">
        {{ request.review ? t("grant.notNow") : t("common.cancel") }}
      </Button>
      <Button type="button" data-testid="grant-allow" :disabled="busy" @click="allow">{{ t("grant.allow") }}</Button>
    </div>
  </ModalDialog>
</template>
