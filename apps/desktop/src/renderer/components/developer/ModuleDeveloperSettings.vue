<script setup lang="ts">
// Settings > Development > Module developer, once signed in: the public developer name and the id
// prefixes the account holds. Saving the name the first time also claims its prefix and makes the
// publisher key (host.ts), so publishing from Tavora needs nothing more here; the keys (Export, Lost
// it?, Unlink), key files, link codes and publish tokens are folded away under Publisher keys and CI.
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import type { AccountPublishToken, HostAction } from "../../../shared/host-api";
import { suggestPrefix } from "../../../shared/id-prefix";
import { account, act, confirmAction, developerKeys, showToast, submitAction } from "../../host";
import { formatDate, t } from "../../i18n";
import SettingGroup from "../settings/SettingGroup.vue";
import SettingRow from "../settings/SettingRow.vue";
import PrefixClaim from "./PrefixClaim.vue";

defineProps<{ highlight: string | null }>();

const view = computed(() => account.value);
const busy = ref(false);

async function run(action: HostAction): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    return (await act(action)).ok;
  } finally {
    busy.value = false;
  }
}

const developerName = ref("");
watch(
  () => view.value?.developer?.name,
  (name) => (developerName.value = name ?? ""),
  { immediate: true },
);
const nameHint = computed(() => {
  const next = view.value?.developer?.nextChangeAt;
  return next && Date.parse(next) > Date.now() ? t("account.developer.nameNext", { date: formatDate(next) }) : t("account.developer.nameHint");
});
async function saveDeveloperName() {
  const name = developerName.value.trim();
  if (await run({ type: "account-developer-name", name })) showToast(t("account.developer.saved", { name }));
}

// One list of publisher keys: the ones linked to the account (oldest first), then the ones Tavora keeps
// in the account's vault but couldn't link yet. Tavora signs modules with a key it keeps; a linked key
// it doesn't keep is a key file, linked with `tavora-pack link`.
const keys = computed(() => developerKeys.value);
const rows = computed(() => {
  const kept = new Set((keys.value?.keys ?? []).map((key) => key.fingerprint));
  const linked = view.value?.publisherKeys ?? [];
  const linkedSet = new Set(linked.map((key) => key.fingerprint));
  return [
    ...linked.map((key) => ({ fingerprint: key.fingerprint, linkedAt: key.linkedAt, kept: kept.has(key.fingerprint) })),
    ...[...kept].filter((fingerprint) => !linkedSet.has(fingerprint)).map((fingerprint) => ({ fingerprint, linkedAt: null, kept: true })),
  ];
});
/** The key a build server gets as a file: the newest linked key Tavora keeps, the one it signs with. */
const exportable = computed(() => rows.value.filter((row) => row.kept && row.linkedAt).at(-1)?.fingerprint ?? null);
async function makeKey() {
  if (await run({ type: "developer-key-create" })) showToast(t("account.developer.created"));
}
async function addKey() {
  const before = keys.value?.keys.length ?? 0;
  if ((await run({ type: "developer-key-add" })) && (keys.value?.keys.length ?? 0) > before) showToast(t("account.developer.added"));
}
function exportKey(fingerprint: string) {
  confirmAction({
    title: t("account.developer.exportTitle"),
    message: t("account.developer.exportMessage"),
    confirm: t("account.developer.export"),
    run: () => submitAction({ type: "developer-key-export", fingerprint }),
  });
}
function unlinkKey(fingerprint: string) {
  confirmAction({
    title: t("account.developer.unlinkTitle"),
    message: t("account.developer.unlinkMessage"),
    confirm: t("account.developer.unlink"),
    run: () => submitAction({ type: "account-unlink-key", fingerprint }),
  });
}

// "I lost this key": the newest request for each linked key, and the key whose choice is open.
const requests = computed(() => new Map((view.value?.keyRequests ?? []).map((request) => [request.old, request])));
const waiting = computed(() => new Set((view.value?.keyRequests ?? []).filter((request) => request.status === "waiting").flatMap((request) => [request.old, request.new])));
const replacing = ref<string | null>(null);
async function replaceKey(fingerprint: string, leaked: boolean) {
  if (await run({ type: "account-replace-key", fingerprint, leaked })) {
    replacing.value = null;
    showToast(t("account.developer.replaceSent"));
  }
}

// The id prefixes the account holds; a new one is suggested from the developer name.
const prefixes = computed(() => view.value?.prefixes ?? null);
const suggested = computed(() => suggestPrefix(view.value?.developer?.name ?? ""));
const addingPrefix = ref(false);
/** The prefix saving the typed name claims with it; none once the account holds one. */
const namePrefix = computed(() => (prefixes.value?.held.length === 0 && developerName.value.trim() !== (view.value?.developer?.name ?? "") ? suggestPrefix(developerName.value) : null));

// Publish from CI: folded away until opened.
const ciOpen = ref(false);
const linkCommandText = computed(() => {
  const code = view.value?.linkCode?.code ?? "";
  return `npx @tavora/pack link ${code.slice(0, 4)}-${code.slice(4)}`;
});
async function copyLinkCommand() {
  if ((await act({ type: "account-copy-link-command" })).ok) showToast(t("account.developer.copied"));
}
// Publish tokens let CI publish with an exported key file; a new one's secret is shown once.
const tokenName = ref("");
async function makeToken() {
  if (await run({ type: "account-publish-token-create", name: tokenName.value.trim() })) tokenName.value = "";
}
async function copyToken() {
  if ((await act({ type: "account-publish-token-copy" })).ok) showToast(t("account.developer.tokenCopied"));
}
function removeToken(token: AccountPublishToken) {
  confirmAction({
    title: t("account.developer.tokenRemoveTitle"),
    message: t("account.developer.tokenRemoveMessage"),
    confirm: t("account.developer.tokenRemove"),
    danger: true,
    run: () => submitAction({ type: "account-publish-token-delete", id: token.id }),
  });
}
</script>

<template>
  <SettingGroup :title="t('account.developer.title')" :description="t('account.developer.hint')">
    <div class="-mx-5 px-5 py-4 transition-colors duration-500" :class="highlight === 'module-developer' && 'bg-primary/10'" data-setting="module-developer" data-testid="account-developer">
      <form class="flex flex-col gap-1" @submit.prevent="saveDeveloperName">
        <label class="text-sm font-medium" for="account-developer-name">{{ t("account.developer.name") }}</label>
        <div class="flex gap-2">
          <Input id="account-developer-name" v-model="developerName" class="max-w-60" maxlength="32" autocomplete="off" spellcheck="false" data-testid="account-developer-name" />
          <Button type="submit" :disabled="busy || !developerName.trim() || developerName.trim() === view?.developer?.name" data-testid="account-developer-save">{{ t("account.developer.save") }}</Button>
        </div>
        <span class="text-muted-foreground text-xs" data-testid="account-developer-name-hint">{{ nameHint }}</span>
        <span v-if="namePrefix" class="text-muted-foreground text-xs" data-testid="account-developer-name-prefix">{{ t("devStart.name.prefix", { prefix: namePrefix }) }}</span>
      </form>

      <div v-if="prefixes && view?.developer" class="mt-6" data-testid="developer-prefixes">
        <span class="text-sm font-medium">{{ t("developer.prefix") }}</span>
        <template v-if="prefixes.held.length">
          <p class="mt-1 text-sm" data-testid="developer-prefixes-list">{{ t("developer.prefixLine", { prefix: prefixes.held.map((item) => item.prefix).join(", ") }) }}</p>
          <Button v-if="!addingPrefix && prefixes.held.length < prefixes.max" variant="ghost" size="sm" class="mt-1 -ml-2" data-testid="developer-prefix-add" @click="addingPrefix = true">{{ t("developer.prefixAdd") }}</Button>
        </template>
        <p v-else class="text-muted-foreground mt-1 text-xs" data-testid="developer-prefixes-none">{{ t("developer.noPrefixes") }}</p>
        <div v-if="!prefixes.held.length || addingPrefix" class="mt-2">
          <PrefixClaim :initial="prefixes.held.length ? null : suggested" @claimed="addingPrefix = false" />
        </div>
      </div>
    </div>
  </SettingGroup>

  <SettingGroup>
    <SettingRow :label="t('settings.publish-ci.label')" :description="t('settings.publish-ci.description')" setting="publish-ci" :highlighted="highlight === 'publish-ci'">
      <Button variant="ghost" :aria-expanded="ciOpen" data-testid="developer-ci-toggle" @click="ciOpen = !ciOpen">
        {{ ciOpen ? t("developer.ciHide") : t("developer.ciShow") }}
      </Button>
    </SettingRow>
    <div v-if="ciOpen" class="py-4" data-testid="developer-ci">
      <div data-testid="developer-keys">
        <span class="text-sm font-medium">{{ t("account.developer.kept") }}</span>
        <p class="text-muted-foreground mt-1 text-xs">{{ t("account.developer.keptHint") }}</p>
        <p v-if="keys?.status === 'ask'" class="text-muted-foreground mt-2 text-sm" data-testid="developer-keys-ask">{{ t("account.developer.askKey") }}</p>
        <p v-else-if="keys?.status === 'offline'" class="text-muted-foreground mt-2 text-sm">{{ t("account.developer.offline") }}</p>
        <p v-if="!rows.length" class="text-muted-foreground mt-2 text-sm" data-testid="developer-keys-none">{{ t("account.developer.noKept") }}</p>
        <ul v-else class="mt-2" data-testid="developer-keys-list">
          <li v-for="row in rows" :key="row.fingerprint" :data-testid="`developer-key-${row.fingerprint}`">
            <div class="flex min-h-10 items-center gap-3">
              <span class="flex-1 font-mono text-sm" :title="row.fingerprint">{{ row.fingerprint.slice(0, 16) }}…</span>
              <template v-if="row.linkedAt">
                <span class="text-muted-foreground text-sm" :data-testid="`account-key-${row.fingerprint}`">
                  {{ t("account.developer.keyLinked", { date: formatDate(row.linkedAt) }) }}<template v-if="!row.kept && keys?.status === 'ready'"> · {{ t("account.developer.fileOnly") }}</template>
                </span>
                <span v-if="requests.get(row.fingerprint)?.status === 'waiting'" class="text-sm" data-testid="account-key-waiting">{{ t("account.developer.replaceWaiting") }}</span>
                <span v-else-if="requests.get(row.fingerprint)?.status === 'done'" class="text-sm" data-testid="account-key-replaced">{{ t("account.developer.replaceDone") }}</span>
                <template v-else>
                  <span v-if="requests.get(row.fingerprint)?.status === 'declined'" class="text-muted-foreground text-sm">{{ t("account.developer.replaceDeclined") }}</span>
                  <Button variant="ghost" size="sm" :disabled="busy" :aria-label="t('account.developer.replaceLabel', { key: row.fingerprint.slice(0, 16) })" data-testid="account-key-replace" @click="replacing = replacing === row.fingerprint ? null : row.fingerprint">
                    {{ t("account.developer.replace") }}
                  </Button>
                </template>
                <Button v-if="!waiting.has(row.fingerprint)" variant="ghost" size="sm" :disabled="busy" :aria-label="t('account.developer.unlinkLabel', { key: row.fingerprint.slice(0, 16) })" @click="unlinkKey(row.fingerprint)">
                  {{ t("account.developer.unlink") }}
                </Button>
              </template>
              <template v-else>
                <span class="text-muted-foreground text-sm">{{ t("account.developer.notLinked") }}</span>
                <Button variant="secondary" size="sm" :disabled="busy || !view?.developer" @click="run({ type: 'developer-key-link', fingerprint: row.fingerprint })">
                  {{ t("account.developer.linkKept") }}
                </Button>
              </template>
            </div>
            <div v-if="replacing === row.fingerprint" class="mb-2 flex flex-col gap-2 rounded-md border p-3" data-testid="account-key-replace-choice">
              <span class="text-sm">{{ t("account.developer.replaceHint") }}</span>
              <div class="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" :disabled="busy" data-testid="account-key-lost" @click="replaceKey(row.fingerprint, false)">{{ t("account.developer.replaceLost") }}</Button>
                <Button variant="destructive" size="sm" :disabled="busy" data-testid="account-key-leaked" @click="replaceKey(row.fingerprint, true)">{{ t("account.developer.replaceLeaked") }}</Button>
                <Button variant="ghost" size="sm" @click="replacing = null">{{ t("common.cancel") }}</Button>
              </div>
            </div>
          </li>
        </ul>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <!-- Saving the name makes the first key; this is for an account left without one. -->
          <Button v-if="keys?.status === 'ready' && !rows.length" variant="secondary" :disabled="busy || !view?.developer" data-testid="developer-key-create" @click="makeKey">{{ t("account.developer.create") }}</Button>
          <Button v-if="exportable" variant="secondary" :disabled="busy" :data-testid="`developer-key-export-${exportable}`" @click="exportKey(exportable)">{{ t("account.developer.exportMine") }}</Button>
          <Button v-if="keys?.status === 'ready'" variant="secondary" :disabled="busy || !view?.developer" data-testid="developer-key-add" @click="addKey">{{ t("account.developer.add") }}</Button>
          <Button variant="ghost" :disabled="busy || !view?.developer" data-testid="account-link-code" @click="run({ type: 'account-link-code' })">{{ t("account.developer.link") }}</Button>
          <span v-if="!view?.developer" class="text-muted-foreground text-sm">{{ t("account.developer.linkNeedsName") }}</span>
        </div>
        <div v-if="view?.linkCode" class="mt-3 flex flex-col gap-2 rounded-md border p-3" data-testid="account-link">
          <span class="text-sm">{{ t("account.developer.linkHint", { time: formatDate(view.linkCode.expiresAt, { timeStyle: "short" }) }) }}</span>
          <div class="flex flex-wrap items-center gap-2">
            <code class="bg-muted rounded px-2 py-1 font-mono text-sm select-all" data-testid="account-link-command">{{ linkCommandText }}</code>
            <Button variant="ghost" size="sm" data-testid="account-link-copy" @click="copyLinkCommand">{{ t("account.developer.copy") }}</Button>
            <Button variant="ghost" size="sm" :disabled="busy" data-testid="account-link-refresh" @click="run({ type: 'account-refresh' })">{{ t("account.developer.refresh") }}</Button>
          </div>
        </div>
      </div>

      <div class="mt-6" data-testid="publish-tokens">
        <span class="text-sm font-medium">{{ t("account.developer.tokens") }}</span>
        <p class="text-muted-foreground mt-1 text-xs">{{ t("account.developer.tokensHint") }}</p>
        <div v-if="view?.newPublishToken" class="mt-2 flex flex-col gap-2 rounded-md border p-3" data-testid="publish-token-new">
          <span class="text-sm">{{ t("account.developer.tokenNew", { name: view.newPublishToken.name }) }}</span>
          <div class="flex flex-wrap items-center gap-2">
            <code class="bg-muted rounded px-2 py-1 font-mono text-sm break-all select-all" data-testid="publish-token-secret">{{ view.newPublishToken.token }}</code>
            <Button variant="ghost" size="sm" data-testid="publish-token-copy" @click="copyToken">{{ t("account.developer.copy") }}</Button>
            <Button variant="secondary" size="sm" data-testid="publish-token-done" @click="run({ type: 'account-publish-token-saved' })">{{ t("account.developer.tokenDone") }}</Button>
          </div>
        </div>
        <p v-if="!view?.publishTokens?.length" class="text-muted-foreground mt-2 text-sm" data-testid="publish-tokens-none">{{ t("account.developer.noTokens") }}</p>
        <ul v-else class="mt-2" data-testid="publish-tokens-list">
          <li v-for="token in view.publishTokens" :key="token.id" class="flex min-h-10 items-center gap-3" :data-testid="`publish-token-${token.id}`">
            <span class="min-w-0 flex-1 truncate text-sm">{{ token.name }}</span>
            <span class="text-muted-foreground text-sm">
              {{
                token.lastUsedAt
                  ? t("account.developer.tokenUsed", { used: formatDate(token.lastUsedAt), date: formatDate(token.expiresAt) })
                  : t("account.developer.tokenUntil", { date: formatDate(token.expiresAt) })
              }}
            </span>
            <Button variant="ghost" size="sm" :disabled="busy" :aria-label="t('account.developer.tokenRemoveLabel', { name: token.name })" @click="removeToken(token)">
              {{ t("account.developer.tokenRemove") }}
            </Button>
          </li>
        </ul>
        <form class="mt-3 flex items-center gap-2" @submit.prevent="makeToken">
          <Input v-model="tokenName" class="max-w-60" maxlength="40" autocomplete="off" spellcheck="false" :aria-label="t('account.developer.tokenName')" :placeholder="t('account.developer.tokenPlaceholder')" data-testid="publish-token-name" />
          <Button type="submit" variant="secondary" :disabled="busy || !view?.developer || !tokenName.trim()" data-testid="publish-token-create">{{ t("account.developer.tokenCreate") }}</Button>
        </form>
      </div>
    </div>
  </SettingGroup>
</template>
