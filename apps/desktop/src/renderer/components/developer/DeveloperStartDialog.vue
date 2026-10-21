<script setup lang="ts">
// The developer onboarding ("Want to make modules?"): from nothing to a module ready to publish, in five
// steps, each skipped when it is done already. Signing in, a developer name and a publisher key are
// needed for Publish; the prefix and the project can wait, so they have Later. A step moves on by itself
// once the account says it is done. Opened from Settings > Development, and by Publish or Save as zip
// while publishing isn't set up (`then`: the module whose Publish opened it, reviewed at the end).
import { CircleCheck, Copy, FolderCode } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import type { HostAction } from "../../../shared/host-api";
import { suggestPrefix } from "../../../shared/id-prefix";
import { account, act, developerKeys, developerReady, dialog, publishModule, showToast, state } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";
import RecoveryKeySettings from "../settings/RecoveryKeySettings.vue";
import SignInForm from "../settings/SignInForm.vue";
import PrefixClaim from "./PrefixClaim.vue";

const props = defineProps<{ then?: string }>();

const STEPS = ["sign-in", "name", "key", "prefix", "project"] as const;
type Step = (typeof STEPS)[number];
const TITLES = {
  "sign-in": "devStart.signIn.title",
  name: "devStart.name.title",
  key: "devStart.key.title",
  prefix: "devStart.prefix.title",
  project: "devStart.project.title",
  done: "devStart.done.title",
} as const;
/** The steps that can wait. */
const OPTIONAL: ReadonlySet<Step> = new Set(["prefix", "project"]);

const view = computed(() => account.value);
const keys = computed(() => developerKeys.value);
const busy = ref(false);
/** Steps put off with Later. */
const later = ref<ReadonlySet<Step>>(new Set());
/** A key was just made or added here: the reminder about the recovery key stays until Next. */
const keyReminder = ref(false);

const done = computed<Record<Step, boolean>>(() => ({
  "sign-in": Boolean(view.value?.account),
  name: Boolean(view.value?.developer),
  // A recovery key on screen (made with the key) is part of this step until it is saved.
  key: developerReady.value && !keys.value?.recoveryKey && !keyReminder.value,
  prefix: (view.value?.prefixes?.held.length ?? 0) > 0,
  project: (state.value?.developmentFolders.length ?? 0) > 0,
}));
const step = computed<Step | null>(() => STEPS.find((item) => !done.value[item] && !later.value.has(item)) ?? null);
const number = computed(() => (step.value ? STEPS.indexOf(step.value) + 1 : STEPS.length));

async function run(action: HostAction): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    return (await act(action)).ok;
  } finally {
    busy.value = false;
  }
}

const developerName = ref(view.value?.developer?.name ?? "");
async function saveName() {
  await run({ type: "account-developer-name", name: developerName.value.trim() });
}

/** A kept key that isn't linked yet (linking failed when it was made). */
const unlinked = computed(() => {
  const linked = new Set((view.value?.publisherKeys ?? []).map((key) => key.fingerprint));
  return keys.value?.keys.find((key) => !linked.has(key.fingerprint)) ?? null;
});
async function makeKey() {
  if (await run({ type: "developer-key-create" })) keyReminder.value = true;
}
async function addKey() {
  const before = keys.value?.keys.length ?? 0;
  if ((await run({ type: "developer-key-add" })) && (keys.value?.keys.length ?? 0) > before) keyReminder.value = true;
}

const suggested = computed(() => suggestPrefix(view.value?.developer?.name ?? ""));

async function copyCommand() {
  if ((await act({ type: "developer-copy-create-command" })).ok) showToast(t("devStart.project.copied"));
}

function skip() {
  if (step.value && OPTIONAL.has(step.value)) later.value = new Set([...later.value, step.value]);
}

function close() {
  dialog.value = null;
}

function finish() {
  dialog.value = null;
  if (props.then && developerReady.value) publishModule(props.then);
}

// The recovery key shown with a new key was the reminder already.
watch(
  () => keys.value?.recoveryKey,
  (shown, before) => {
    if (before && !shown) keyReminder.value = false;
  },
);

// Signed out meanwhile (from another PC): back to the first step, whatever was put off.
watch(
  () => done.value["sign-in"],
  (signedIn) => {
    if (!signedIn) later.value = new Set();
  },
);
</script>

<template>
  <ModalDialog :title="t(TITLES[step ?? 'done'])" class="sm:max-w-[480px]" testid="developer-start" @close="close">
    <p v-if="step" class="text-muted-foreground -mt-2 text-xs" data-testid="developer-start-step">{{ t("devStart.step", { step: number, count: STEPS.length }) }}</p>

    <template v-if="step === 'sign-in'">
      <p class="text-muted-foreground text-sm">{{ t("devStart.signIn.text") }}</p>
      <SignInForm />
    </template>

    <form v-else-if="step === 'name'" class="flex flex-col gap-3" @submit.prevent="developerName.trim() && saveName()">
      <p class="text-muted-foreground text-sm">{{ t("devStart.name.text") }}</p>
      <div class="flex gap-2">
        <Input v-model="developerName" class="max-w-60" maxlength="32" autocomplete="off" spellcheck="false" :aria-label="t('account.developer.name')" data-testid="developer-start-name" autofocus />
        <Button type="submit" :disabled="busy || !developerName.trim()" data-testid="developer-start-name-save">{{ t("common.next") }}</Button>
      </div>
    </form>

    <template v-else-if="step === 'key'">
      <p class="text-muted-foreground text-sm">{{ t("devStart.key.text") }}</p>
      <!-- Another PC made the account's key: its recovery key opens the vault here first. And a new one is shown once. -->
      <template v-if="keys?.status === 'ask' || keys?.recoveryKey">
        <p v-if="keys.recoveryKey" class="text-sm">{{ t("devStart.key.safe") }}</p>
        <RecoveryKeySettings />
      </template>
      <p v-else-if="keys?.status === 'offline'" class="text-muted-foreground text-sm">{{ t("account.developer.offline") }}</p>
      <div v-else-if="developerReady" class="flex flex-col gap-3" data-testid="developer-start-key-ready">
        <p class="flex items-center gap-2 text-sm"><CircleCheck class="text-success size-4 flex-none" :stroke-width="1.5" /> {{ t("devStart.key.ready") }}</p>
        <p class="text-muted-foreground text-sm">{{ t("devStart.key.safe") }}</p>
        <div class="flex justify-end">
          <Button data-testid="developer-start-next" @click="keyReminder = false">{{ t("common.next") }}</Button>
        </div>
      </div>
      <div v-else-if="unlinked" class="flex flex-col gap-3">
        <p class="text-sm">{{ t("devStart.key.notLinked") }}</p>
        <div>
          <Button :disabled="busy" data-testid="developer-start-link" @click="run({ type: 'developer-key-link', fingerprint: unlinked.fingerprint })">{{ t("devStart.key.link") }}</Button>
        </div>
      </div>
      <div v-else class="flex flex-wrap gap-2">
        <Button :disabled="busy || keys?.status === 'loading'" data-testid="developer-start-make-key" @click="makeKey">{{ t("devStart.key.make") }}</Button>
        <Button variant="ghost" :disabled="busy || keys?.status === 'loading'" data-testid="developer-start-add-key" @click="addKey">{{ t("devStart.key.have") }}</Button>
      </div>
    </template>

    <template v-else-if="step === 'prefix'">
      <p class="text-muted-foreground text-sm">{{ t("devStart.prefix.text", { prefix: suggested ?? "you" }) }}</p>
      <PrefixClaim :initial="suggested" />
      <div class="flex justify-end">
        <Button variant="ghost" data-testid="developer-start-later" @click="skip">{{ t("devStart.later") }}</Button>
      </div>
    </template>

    <template v-else-if="step === 'project'">
      <p class="text-muted-foreground text-sm">{{ t("devStart.project.text") }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <code class="bg-muted rounded px-2 py-1 font-mono text-sm select-all">npm create @tavora/module</code>
        <Button variant="ghost" size="sm" data-testid="developer-start-copy" @click="copyCommand"><Copy :stroke-width="1.5" /> {{ t("devStart.project.copy") }}</Button>
      </div>
      <div class="flex justify-between gap-2">
        <Button variant="secondary" data-testid="developer-start-folder" @click="act({ type: 'add-development-folder' })">
          <FolderCode :stroke-width="1.5" /> {{ t("devStart.project.pick") }}
        </Button>
        <Button variant="ghost" data-testid="developer-start-later" @click="skip">{{ t("devStart.later") }}</Button>
      </div>
    </template>

    <template v-else>
      <p class="text-muted-foreground text-sm" data-testid="developer-start-done">{{ t("devStart.done.text") }}</p>
      <div class="flex justify-end">
        <Button data-testid="developer-start-finish" @click="finish">{{ t("devStart.done.button") }}</Button>
      </div>
    </template>
  </ModalDialog>
</template>
