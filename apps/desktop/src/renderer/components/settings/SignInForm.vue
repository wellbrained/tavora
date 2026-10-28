<script setup lang="ts">
// Signing in to the Tavora account: an address, then its code, then (for a new address or Discord login)
// yes to an account. Settings > Account shows it while signed out, and so does the developer onboarding.
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { CodeInput, codeDigits } from "@tavora/official-ui/components/ui/code-input";
import { Input } from "@tavora/official-ui/components/ui/input";
import type { HostAction } from "../../../shared/host-api";
import { account, act } from "../../host";
import { t } from "../../i18n";

/** The settings search's id for the form, where Settings shows it. */
defineProps<{ setting?: string }>();

const view = computed(() => account.value);
const pending = computed(() => view.value?.pending ?? null);

const email = ref("");
const code = ref("");
/** The minimum-age tick box when creating an account; nothing about it is kept. */
const ageConfirmed = ref(false);
const busy = ref(false);
/** True while Discord's page is open in the browser and Tavora waits for its return. */
const waitingDiscord = ref(false);
/** A new account waits for the user's yes: from an email code or a Discord login. */
const creating = computed(() => (pending.value?.kind === "sign-in" && pending.value.step === "create") || pending.value?.kind === "discord-create");

/** Why the last step failed, shown in the form next to what the user typed instead of as a toast. */
const error = ref<string | null>(null);

// A new step always starts with an empty code box and no old error.
watch(pending, () => {
  code.value = "";
  error.value = null;
});

async function run(action: HostAction): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  error.value = null;
  try {
    const result = await act(action, { quiet: true });
    if (!result.ok) error.value = result.error;
    return result.ok;
  } finally {
    busy.value = false;
  }
}

const cleanCode = computed(() => codeDigits(code.value));
const codeReady = computed(() => cleanCode.value.length === 6);

async function discordSignIn() {
  waitingDiscord.value = true;
  try {
    await run({ type: "account-discord-sign-in" });
  } finally {
    waitingDiscord.value = false;
  }
}
</script>

<template>
  <div v-if="creating" class="flex flex-col gap-3 py-4" :data-setting="setting">
    <span class="font-medium">{{ t("account.create.label") }}</span>
    <span v-if="pending?.kind === 'discord-create'" class="text-muted-foreground">{{ t("account.create.descriptionDiscord", { name: pending.name }) }}</span>
    <span v-else-if="pending?.kind === 'sign-in'" class="text-muted-foreground">{{ t("account.create.description", { email: pending.email }) }}</span>
    <label class="flex items-start gap-3">
      <Checkbox v-model="ageConfirmed" class="mt-1 flex-none" data-testid="account-age" />
      <span>{{ t("account.create.age") }}</span>
    </label>
    <div class="flex gap-2">
      <Button :disabled="busy || !ageConfirmed" data-testid="account-create" @click="run({ type: 'account-create', ageConfirmed })">{{ t("account.create.confirm") }}</Button>
      <Button variant="secondary" :disabled="busy" data-testid="account-cancel" @click="run({ type: 'account-cancel' })">{{ t("common.cancel") }}</Button>
    </div>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="account-error">{{ error }}</p>
  </div>

  <form
    v-else-if="pending?.kind === 'sign-in'"
    class="flex flex-col gap-3 py-4"
    :data-setting="setting"
    @submit.prevent="codeReady && run({ type: 'account-verify', code: cleanCode })"
  >
    <span class="text-muted-foreground" data-testid="account-code-sent">{{ t("account.code.sent", { email: pending.email }) }}</span>
    <div class="flex gap-2">
      <CodeInput v-model="code" :placeholder="t('account.code.placeholder')" :aria-label="t('account.code.label')" data-testid="account-code" />
      <Button type="submit" :disabled="busy || !codeReady" data-testid="account-verify">{{ t("account.signIn") }}</Button>
    </div>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="account-error">{{ error }}</p>
    <div class="flex gap-2">
      <Button type="button" variant="ghost" size="sm" :disabled="busy" data-testid="account-resend" @click="run({ type: 'account-send-code', email: pending.email })">{{ t("account.code.resend") }}</Button>
      <Button type="button" variant="ghost" size="sm" :disabled="busy" data-testid="account-cancel" @click="run({ type: 'account-cancel' })">{{ t("account.code.otherAddress") }}</Button>
    </div>
  </form>

  <form v-else class="flex flex-col gap-3 py-4" :data-setting="setting" @submit.prevent="email.trim() && run({ type: 'account-send-code', email })">
    <span class="font-medium">{{ t("account.email.label") }}</span>
    <div class="flex gap-2">
      <Input v-model="email" type="email" class="max-w-80" autocomplete="email" maxlength="254" :placeholder="t('account.email.placeholder')" :aria-label="t('account.email.label')" data-testid="account-email" />
      <Button type="submit" :disabled="busy || !email.trim()" data-testid="account-send-code">{{ t("account.code.send") }}</Button>
    </div>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="account-error">{{ error }}</p>
    <span class="text-muted-foreground text-sm">{{ t("account.email.hint") }}</span>
    <template v-if="view?.discordLogin">
      <span class="text-muted-foreground text-sm">{{ t("account.discord.or") }}</span>
      <div>
        <Button type="button" variant="secondary" :disabled="busy" data-testid="account-discord-sign-in" @click="discordSignIn">{{ t("account.discord.signIn") }}</Button>
      </div>
    </template>
  </form>

  <p v-if="waitingDiscord" class="text-muted-foreground pb-4" role="status" data-testid="account-discord-waiting">{{ t("account.discord.waiting") }}</p>
</template>
