<script setup lang="ts">
// Settings > Account: the optional Tavora account. Signing in is an emailed
// code, never a password. The main process talks to the service and keeps the
// sign-in; this page only sees the address, the devices and where a sign-in is.
import { computed, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccountDevice, HostAction } from "../../../shared/host-api";
import { account, act, confirmAction, submitAction } from "../../host";
import { formatDate, t } from "../../i18n";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const view = computed(() => account.value);
const signedIn = computed(() => view.value?.account ?? null);
const pending = computed(() => view.value?.pending ?? null);

const email = ref("");
const code = ref("");
const newEmail = ref("");
const changing = ref(false);
const busy = ref(false);

// A new step always starts with an empty code box.
watch(pending, () => (code.value = ""));

onMounted(() => {
  // The devices and the address as the service has them now; quietly, offline is fine.
  if (signedIn.value) void act({ type: "account-refresh" }, { quiet: true });
});

async function run(action: HostAction): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    return (await act(action)).ok;
  } finally {
    busy.value = false;
  }
}

const cleanCode = computed(() => code.value.replace(/\D/g, "").slice(0, 6));
const codeReady = computed(() => cleanCode.value.length === 6);

async function sendEmailCode() {
  if (await run({ type: "account-email-code", email: newEmail.value })) changing.value = false;
}

function osName(device: AccountDevice): string {
  return t(device.os === "other" ? "account.os.unknown" : `account.os.${device.os}`);
}

function signOutDevice(device: AccountDevice) {
  confirmAction({
    title: t("account.devices.signOutTitle"),
    message: t("account.devices.signOutMessage", { device: osName(device), date: formatDate(device.createdAt) }),
    confirm: t("account.signOut"),
    run: () => submitAction({ type: "account-sign-out-device", deviceId: device.id }),
  });
}

function startDelete() {
  confirmAction({
    title: t("account.delete.title"),
    message: t("account.delete.message"),
    confirm: t("account.delete.sendCode"),
    danger: true,
    run: () => submitAction({ type: "account-delete-code" }),
  });
}
</script>

<template>
  <section data-testid="account">
    <h3 class="text-lg font-semibold">{{ t("account.title") }}</h3>
    <p class="text-muted-foreground mt-1 mb-4">{{ t("account.intro") }}</p>

    <!-- Signed out: an address, then its code, then (for a new address) yes to an account. -->
    <template v-if="!signedIn">
      <SettingRow
        v-if="pending?.kind === 'sign-in' && pending.step === 'create'"
        :label="t('account.create.label')"
        :description="t('account.create.description', { email: pending.email })"
        setting="account"
        :highlighted="highlight === 'account'"
      >
        <div class="flex flex-none gap-2">
          <Button variant="ghost" :disabled="busy" data-testid="account-cancel" @click="run({ type: 'account-cancel' })">{{ t("common.cancel") }}</Button>
          <Button :disabled="busy" data-testid="account-create" @click="run({ type: 'account-create' })">{{ t("account.create.confirm") }}</Button>
        </div>
      </SettingRow>

      <form
        v-else-if="pending?.kind === 'sign-in'"
        class="flex flex-col gap-3 border-b pb-4"
        data-setting="account"
        @submit.prevent="codeReady && run({ type: 'account-verify', code: cleanCode })"
      >
        <span class="text-muted-foreground" data-testid="account-code-sent">{{ t("account.code.sent", { email: pending.email }) }}</span>
        <div class="flex gap-2">
          <Input v-model="code" class="w-40 tracking-widest tabular-nums" inputmode="numeric" autocomplete="one-time-code" maxlength="7" :placeholder="t('account.code.placeholder')" :aria-label="t('account.code.label')" data-testid="account-code" />
          <Button type="submit" :disabled="busy || !codeReady" data-testid="account-verify">{{ t("account.signIn") }}</Button>
        </div>
        <div class="flex gap-2">
          <Button type="button" variant="ghost" size="sm" :disabled="busy" data-testid="account-resend" @click="run({ type: 'account-send-code', email: pending.email })">{{ t("account.code.resend") }}</Button>
          <Button type="button" variant="ghost" size="sm" :disabled="busy" data-testid="account-cancel" @click="run({ type: 'account-cancel' })">{{ t("account.code.otherAddress") }}</Button>
        </div>
      </form>

      <form v-else class="flex flex-col gap-3 border-b pb-4" data-setting="account" @submit.prevent="email.trim() && run({ type: 'account-send-code', email })">
        <span class="font-medium">{{ t("account.email.label") }}</span>
        <div class="flex gap-2">
          <Input v-model="email" type="email" class="max-w-80" autocomplete="email" maxlength="254" :placeholder="t('account.email.placeholder')" :aria-label="t('account.email.label')" data-testid="account-email" />
          <Button type="submit" :disabled="busy || !email.trim()" data-testid="account-send-code">{{ t("account.code.send") }}</Button>
        </div>
        <span class="text-muted-foreground text-sm">{{ t("account.email.hint") }}</span>
      </form>
    </template>

    <!-- Signed in. -->
    <template v-else>
      <SettingRow :label="t('account.email.label')" :description="signedIn.email" setting="account" :highlighted="highlight === 'account'">
        <Button v-if="!changing && pending?.kind !== 'change-email'" variant="secondary" data-testid="account-change-email" @click="(changing = true), (newEmail = '')">{{ t("account.email.change") }}</Button>
      </SettingRow>

      <form v-if="changing" class="flex flex-col gap-3 border-b py-4" @submit.prevent="newEmail.trim() && sendEmailCode()">
        <span class="text-muted-foreground">{{ t("account.email.newHint") }}</span>
        <div class="flex gap-2">
          <Input v-model="newEmail" type="email" class="max-w-80" autocomplete="email" maxlength="254" :placeholder="t('account.email.placeholder')" :aria-label="t('account.email.new')" data-testid="account-new-email" />
          <Button type="submit" :disabled="busy || !newEmail.trim()" data-testid="account-email-code">{{ t("account.code.send") }}</Button>
          <Button type="button" variant="ghost" @click="changing = false">{{ t("common.cancel") }}</Button>
        </div>
      </form>

      <form
        v-if="pending?.kind === 'change-email'"
        class="flex flex-col gap-3 border-b py-4"
        @submit.prevent="codeReady && run({ type: 'account-change-email', code: cleanCode })"
      >
        <span class="text-muted-foreground">{{ t("account.code.sent", { email: pending.email }) }}</span>
        <div class="flex gap-2">
          <Input v-model="code" class="w-40 tracking-widest tabular-nums" inputmode="numeric" autocomplete="one-time-code" maxlength="7" :placeholder="t('account.code.placeholder')" :aria-label="t('account.code.label')" data-testid="account-code" />
          <Button type="submit" :disabled="busy || !codeReady" data-testid="account-confirm-email">{{ t("account.email.confirm") }}</Button>
          <Button type="button" variant="ghost" :disabled="busy" @click="run({ type: 'account-cancel' })">{{ t("common.cancel") }}</Button>
        </div>
      </form>

      <div class="border-b py-4">
        <span class="font-medium">{{ t("account.devices.title") }}</span>
        <p v-if="!view?.devices" class="text-muted-foreground mt-1">{{ t("account.devices.unknown") }}</p>
        <ul v-else class="mt-2" data-testid="account-devices">
          <li v-for="device in view.devices" :key="device.id" class="flex min-h-10 items-center gap-3" :data-testid="`account-device-${device.id}`">
            <span class="flex-1">
              {{ t("account.devices.entry", { device: osName(device), date: formatDate(device.createdAt) }) }}
            </span>
            <span v-if="device.current" class="text-muted-foreground text-sm">{{ t("account.devices.thisPc") }}</span>
            <Button v-else variant="ghost" size="sm" :disabled="busy" @click="signOutDevice(device)">{{ t("account.signOut") }}</Button>
          </li>
        </ul>
      </div>

      <SettingRow :label="t('account.signOut')" :description="t('account.signOutHint')">
        <Button variant="secondary" :disabled="busy" data-testid="account-sign-out" @click="run({ type: 'account-sign-out' })">{{ t("account.signOut") }}</Button>
      </SettingRow>

      <form
        v-if="pending?.kind === 'delete'"
        class="flex flex-col gap-3 py-4"
        @submit.prevent="codeReady && run({ type: 'account-delete', code: cleanCode })"
      >
        <span class="text-muted-foreground">{{ t("account.delete.codeSent", { email: signedIn.email }) }}</span>
        <div class="flex gap-2">
          <Input v-model="code" class="w-40 tracking-widest tabular-nums" inputmode="numeric" autocomplete="one-time-code" maxlength="7" :placeholder="t('account.code.placeholder')" :aria-label="t('account.code.label')" data-testid="account-code" />
          <Button type="submit" variant="destructive" :disabled="busy || !codeReady" data-testid="account-delete">{{ t("account.delete.confirm") }}</Button>
          <Button type="button" variant="ghost" :disabled="busy" @click="run({ type: 'account-cancel' })">{{ t("common.cancel") }}</Button>
        </div>
      </form>
      <SettingRow v-else :label="t('account.delete.label')" :description="t('account.delete.description')">
        <Button variant="destructive" :disabled="busy" data-testid="account-start-delete" @click="startDelete">{{ t("account.delete.label") }}</Button>
      </SettingRow>
    </template>

    <p v-if="view && !view.canKeepSignIn" class="text-muted-foreground mt-4 text-sm" data-testid="account-cant-keep">{{ t("account.cantKeep") }}</p>
  </section>
</template>
