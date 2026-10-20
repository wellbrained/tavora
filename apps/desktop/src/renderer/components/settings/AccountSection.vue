<script setup lang="ts">
// Settings > Account: the optional Tavora account. Signing in is an emailed
// code or a Discord login in the browser, never a password. The main process
// talks to the service and keeps the sign-in; this page only sees the sign-in
// methods, the devices and where a sign-in is.
import { computed, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccountDevice, HostAction } from "../../../shared/host-api";
import { account, act, confirmAction, prompt, showToast, submitAction } from "../../host";
import { formatDate, t } from "../../i18n";
import CloudCopySettings from "./CloudCopySettings.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const view = computed(() => account.value);
const signedIn = computed(() => view.value?.account ?? null);
const pending = computed(() => view.value?.pending ?? null);
/** How the account's profile is described when it differs from this PC's. */
const accountProfile = computed(() => {
  const choice = view.value?.profileChoice;
  if (!choice) return "";
  const name = choice.name || choice.initials || t("account.profileChoice.noName");
  return choice.picture ? t("account.profileChoice.withPicture", { name }) : name;
});

const email = ref("");
const code = ref("");
const newEmail = ref("");
/** The minimum-age tick box when creating an account; nothing about it is kept. */
const ageConfirmed = ref(false);
const changing = ref(false);
const busy = ref(false);
/** True while Discord's page is open in the browser and Tavora waits for its return. */
const waitingDiscord = ref(false);
/** A new account waits for the player's yes: from an email code or a Discord login. */
const creating = computed(() => (pending.value?.kind === "sign-in" && pending.value.step === "create") || pending.value?.kind === "discord-create");

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

/** A Discord step: the browser opens, and the page says Tavora is waiting for it. */
async function runDiscord(action: HostAction): Promise<boolean> {
  waitingDiscord.value = true;
  try {
    return await run(action);
  } finally {
    waitingDiscord.value = false;
  }
}

async function sendEmailCode() {
  if (await run({ type: "account-email-code", email: newEmail.value })) changing.value = false;
}

function osName(device: AccountDevice): string {
  return t(device.os === "other" ? "account.os.unknown" : `account.os.${device.os}`);
}

/** The device's name, or its system for a sign-in from before devices had names. */
function deviceLabel(device: AccountDevice): string {
  return device.name ?? osName(device);
}

/** The devices list is folded away until the player opens it. */
const devicesOpen = ref(false);

function renameDevice(device: AccountDevice) {
  prompt({
    title: t("account.devices.renameTitle"),
    label: t("account.devices.name"),
    value: device.name ?? "",
    maxLength: 40,
    confirm: t("common.save"),
    submit: (name) => submitAction({ type: "account-rename-device", deviceId: device.id, name }),
  });
}

function signOutDevice(device: AccountDevice) {
  confirmAction({
    title: t("account.devices.signOutTitle"),
    message: t("account.devices.signOutMessage", { device: deviceLabel(device), date: formatDate(device.createdAt) }),
    confirm: t("account.signOut"),
    run: () => submitAction({ type: "account-sign-out-device", deviceId: device.id }),
  });
}

// The developer side: the public name, the linked publisher keys and a code to link another.
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
const linkCommandText = computed(() => {
  const code = view.value?.linkCode?.code ?? "";
  return `npx @tavora/pack link ${code.slice(0, 4)}-${code.slice(4)}`;
});
async function copyLinkCommand() {
  if ((await act({ type: "account-copy-link-command" })).ok) showToast(t("account.developer.copied"));
}
function unlinkKey(fingerprint: string) {
  confirmAction({
    title: t("account.developer.unlinkTitle"),
    message: t("account.developer.unlinkMessage"),
    confirm: t("account.developer.unlink"),
    run: () => submitAction({ type: "account-unlink-key", fingerprint }),
  });
}

function startDelete() {
  // An account without an email address confirms with a fresh Discord sign-in instead of a code.
  if (!signedIn.value?.email) {
    confirmAction({
      title: t("account.delete.title"),
      message: t("account.delete.messageDiscord"),
      confirm: t("account.delete.withDiscord"),
      danger: true,
      run: async () => {
        waitingDiscord.value = true;
        try {
          return await submitAction({ type: "account-delete-discord" });
        } finally {
          waitingDiscord.value = false;
        }
      },
    });
    return;
  }
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
    <p class="text-muted-foreground mb-6 max-w-prose text-sm">{{ t("account.intro") }}</p>

    <!-- Signed out: an address, then its code, then (for a new address) yes to an account. -->
    <SettingGroup v-if="!signedIn" :title="t('account.title')">
      <div v-if="creating" class="flex flex-col gap-3 py-4" data-setting="account">
        <span class="font-medium">{{ t("account.create.label") }}</span>
        <span v-if="pending?.kind === 'discord-create'" class="text-muted-foreground">{{ t("account.create.descriptionDiscord", { name: pending.name }) }}</span>
        <span v-else-if="pending?.kind === 'sign-in'" class="text-muted-foreground">{{ t("account.create.description", { email: pending.email }) }}</span>
        <label class="flex items-start gap-3">
          <input v-model="ageConfirmed" type="checkbox" class="accent-primary mt-1 size-4 flex-none" data-testid="account-age" />
          <span>{{ t("account.create.age") }}</span>
        </label>
        <div class="flex gap-2">
          <Button :disabled="busy || !ageConfirmed" data-testid="account-create" @click="run({ type: 'account-create', ageConfirmed })">{{ t("account.create.confirm") }}</Button>
          <Button variant="ghost" :disabled="busy" data-testid="account-cancel" @click="run({ type: 'account-cancel' })">{{ t("common.cancel") }}</Button>
        </div>
      </div>

      <form
        v-else-if="pending?.kind === 'sign-in'"
        class="flex flex-col gap-3 py-4"
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

      <form v-else class="flex flex-col gap-3 py-4" data-setting="account" @submit.prevent="email.trim() && run({ type: 'account-send-code', email })">
        <span class="font-medium">{{ t("account.email.label") }}</span>
        <div class="flex gap-2">
          <Input v-model="email" type="email" class="max-w-80" autocomplete="email" maxlength="254" :placeholder="t('account.email.placeholder')" :aria-label="t('account.email.label')" data-testid="account-email" />
          <Button type="submit" :disabled="busy || !email.trim()" data-testid="account-send-code">{{ t("account.code.send") }}</Button>
        </div>
        <span class="text-muted-foreground text-sm">{{ t("account.email.hint") }}</span>
        <template v-if="view?.discordLogin">
          <span class="text-muted-foreground text-sm">{{ t("account.discord.or") }}</span>
          <div>
            <Button type="button" variant="secondary" :disabled="busy" data-testid="account-discord-sign-in" @click="runDiscord({ type: 'account-discord-sign-in' })">{{ t("account.discord.signIn") }}</Button>
          </div>
        </template>
      </form>
    </SettingGroup>

    <!-- Signed in. -->
    <template v-else>
      <SettingGroup v-if="view?.profileChoice">
        <SettingRow :label="t('account.profileChoice.label')" :description="t('account.profileChoice.description', { profile: accountProfile })" data-testid="account-profile-choice">
          <div class="flex flex-none gap-2">
            <Button variant="secondary" :disabled="busy" data-testid="account-keep-pc" @click="run({ type: 'account-profile-choice', keep: 'pc' })">{{ t("account.profileChoice.keepPc") }}</Button>
            <Button :disabled="busy" data-testid="account-keep-account" @click="run({ type: 'account-profile-choice', keep: 'account' })">{{ t("account.profileChoice.useAccount") }}</Button>
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup
        :title="t('account.methods.title')"
        :description="t('account.methods.hint')"
        data-setting="account"
        :data-highlighted="highlight === 'account' || undefined"
        data-testid="account-methods"
      >
      <SettingRow :label="t('account.methods.email')" :description="signedIn.email ?? t('account.methods.emailNone')">
        <div v-if="!changing && pending?.kind !== 'change-email' && pending?.kind !== 'remove-email'" class="flex flex-none gap-2">
          <Button v-if="signedIn.email && signedIn.discord" variant="danger" :disabled="busy" data-testid="account-remove-email" @click="run({ type: 'account-email-remove-code' })">{{ t("account.email.remove") }}</Button>
          <Button variant="secondary" data-testid="account-change-email" @click="(changing = true), (newEmail = '')">{{ signedIn.email ? t("account.email.change") : t("account.email.add") }}</Button>
        </div>
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

      <!-- Removing the email needs the code sent to it, so a stolen sign-in cannot cut the owner out. -->
      <form
        v-if="pending?.kind === 'remove-email'"
        class="flex flex-col gap-3 border-b py-4"
        @submit.prevent="codeReady && run({ type: 'account-email-remove', code: cleanCode })"
      >
        <span class="text-muted-foreground">{{ t("account.email.removeCodeSent", { email: signedIn.email ?? "" }) }}</span>
        <div class="flex gap-2">
          <Input v-model="code" class="w-40 tracking-widest tabular-nums" inputmode="numeric" autocomplete="one-time-code" maxlength="7" :placeholder="t('account.code.placeholder')" :aria-label="t('account.code.label')" data-testid="account-code" />
          <Button type="submit" variant="destructive" :disabled="busy || !codeReady" data-testid="account-confirm-remove-email">{{ t("account.email.removeConfirm") }}</Button>
          <Button type="button" variant="ghost" :disabled="busy" @click="run({ type: 'account-cancel' })">{{ t("common.cancel") }}</Button>
        </div>
      </form>

      <SettingRow
        v-if="view?.discordLogin || signedIn.discord"
        :label="t('account.methods.discord')"
        :description="signedIn.discord ? t('account.methods.discordConnected', { name: signedIn.discord.name }) : t('account.methods.discordNone')"
        data-testid="account-discord"
      >
        <template v-if="pending?.kind !== 'connect-discord' && pending?.kind !== 'remove-discord'">
          <Button v-if="signedIn.discord && signedIn.email" variant="secondary" :disabled="busy" data-testid="account-discord-disconnect" @click="run({ type: 'account-discord-disconnect-code' })">{{ t("account.discord.disconnect") }}</Button>
          <Button v-else-if="!signedIn.discord" variant="secondary" :disabled="busy" data-testid="account-discord-connect" @click="run({ type: 'account-discord-connect-code' })">{{ t("account.discord.connect") }}</Button>
        </template>
      </SettingRow>

      <!-- Connecting or disconnecting Discord needs the code sent to the account's address (A6). -->
      <form
        v-if="pending?.kind === 'connect-discord' || pending?.kind === 'remove-discord'"
        class="flex flex-col gap-3 border-b py-4"
        @submit.prevent="codeReady && (pending?.kind === 'connect-discord' ? runDiscord({ type: 'account-discord-connect', code: cleanCode }) : run({ type: 'account-discord-disconnect', code: cleanCode }))"
      >
        <span class="text-muted-foreground">{{ t(pending.kind === "connect-discord" ? "account.discord.connectCodeSent" : "account.discord.disconnectCodeSent", { email: signedIn.email ?? "" }) }}</span>
        <div class="flex gap-2">
          <Input v-model="code" class="w-40 tracking-widest tabular-nums" inputmode="numeric" autocomplete="one-time-code" maxlength="7" :placeholder="t('account.code.placeholder')" :aria-label="t('account.code.label')" data-testid="account-code" />
          <Button type="submit" :disabled="busy || !codeReady" data-testid="account-confirm-discord">{{ t(pending.kind === "connect-discord" ? "account.discord.connectConfirm" : "account.discord.disconnectConfirm") }}</Button>
          <Button type="button" variant="ghost" :disabled="busy" @click="run({ type: 'account-cancel' })">{{ t("common.cancel") }}</Button>
        </div>
      </form>

      </SettingGroup>

      <CloudCopySettings />

      <!-- The developer side: only matters to people who make modules. -->
      <SettingGroup :title="t('account.developer.title')" :description="t('account.developer.hint')">
      <div class="py-4" data-testid="account-developer">

        <form class="flex flex-col gap-1" @submit.prevent="saveDeveloperName">
          <label class="text-sm font-medium" for="account-developer-name">{{ t("account.developer.name") }}</label>
          <div class="flex gap-2">
            <Input id="account-developer-name" v-model="developerName" class="max-w-60" maxlength="32" autocomplete="off" spellcheck="false" data-testid="account-developer-name" />
            <Button type="submit" :disabled="busy || !developerName.trim() || developerName.trim() === view?.developer?.name" data-testid="account-developer-save">{{ t("account.developer.save") }}</Button>
          </div>
          <span class="text-muted-foreground text-xs" data-testid="account-developer-name-hint">{{ nameHint }}</span>
        </form>

        <div class="mt-4">
          <span class="text-sm font-medium">{{ t("account.developer.keys") }}</span>
          <p v-if="!view?.publisherKeys?.length" class="text-muted-foreground mt-1 text-sm" data-testid="account-keys-none">{{ t("account.developer.noKeys") }}</p>
          <ul v-else class="mt-1" data-testid="account-keys">
            <li v-for="key in view.publisherKeys" :key="key.fingerprint" class="flex min-h-10 items-center gap-3" :data-testid="`account-key-${key.fingerprint}`">
              <span class="flex-1 font-mono text-sm" :title="key.fingerprint">{{ key.fingerprint.slice(0, 16) }}…</span>
              <span class="text-muted-foreground text-sm">{{ t("account.developer.keyLinked", { date: formatDate(key.linkedAt) }) }}</span>
              <Button variant="ghost" size="sm" :disabled="busy" :aria-label="t('account.developer.unlinkLabel', { key: key.fingerprint.slice(0, 16) })" @click="unlinkKey(key.fingerprint)">
                {{ t("account.developer.unlink") }}
              </Button>
            </li>
          </ul>
        </div>

        <div class="mt-3 flex flex-col gap-3">
          <div class="flex items-center gap-3">
            <Button variant="secondary" :disabled="busy || !view?.developer" data-testid="account-link-code" @click="run({ type: 'account-link-code' })">{{ t("account.developer.link") }}</Button>
            <span v-if="!view?.developer" class="text-muted-foreground text-sm">{{ t("account.developer.linkNeedsName") }}</span>
          </div>
          <div v-if="view?.linkCode" class="flex flex-col gap-2 rounded-md border p-3" data-testid="account-link">
            <span class="text-sm">{{ t("account.developer.linkHint", { time: formatDate(view.linkCode.expiresAt, { timeStyle: "short" }) }) }}</span>
            <div class="flex flex-wrap items-center gap-2">
              <code class="bg-muted rounded px-2 py-1 font-mono text-sm select-all" data-testid="account-link-command">{{ linkCommandText }}</code>
              <Button variant="ghost" size="sm" data-testid="account-link-copy" @click="copyLinkCommand">{{ t("account.developer.copy") }}</Button>
              <Button variant="ghost" size="sm" :disabled="busy" data-testid="account-link-refresh" @click="run({ type: 'account-refresh' })">{{ t("account.developer.refresh") }}</Button>
            </div>
          </div>
        </div>
      </div>
      </SettingGroup>

      <SettingGroup :title="t('account.heading.manage')">
      <SettingRow :label="t('account.signOut')" :description="t('account.signOutHint')">
        <Button variant="secondary" :disabled="busy" data-testid="account-sign-out" @click="run({ type: 'account-sign-out' })">{{ t("account.signOut") }}</Button>
      </SettingRow>

      <!-- Every PC signed in to the account, folded away: rarely needed. -->
      <SettingRow
        :label="view?.devices ? t('account.devices.titleCount', { count: view.devices.length }) : t('account.devices.title')"
        :description="t('account.devices.description')"
      >
        <Button variant="ghost" :aria-expanded="devicesOpen" data-testid="account-devices-toggle" @click="devicesOpen = !devicesOpen">
          {{ devicesOpen ? t("account.devices.hide") : t("account.devices.show") }}
        </Button>
      </SettingRow>
      <div v-if="devicesOpen" class="border-b py-2">
        <p v-if="!view?.devices" class="text-muted-foreground py-1 text-sm">{{ t("account.devices.unknown") }}</p>
        <ul v-else data-testid="account-devices">
          <li v-for="device in view.devices" :key="device.id" class="flex min-h-12 items-center gap-3 py-1" :data-testid="`account-device-${device.id}`">
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-medium">{{ deviceLabel(device) }}<span v-if="device.current" class="text-muted-foreground font-normal"> · {{ t("account.devices.thisPc") }}</span></span>
              <span class="text-muted-foreground text-sm">{{ t("account.devices.entry", { device: osName(device), date: formatDate(device.createdAt) }) }}</span>
            </span>
            <Button variant="ghost" size="sm" :disabled="busy" :data-testid="`account-device-rename-${device.id}`" @click="renameDevice(device)">{{ t("account.devices.rename") }}</Button>
            <Button v-if="!device.current" variant="danger" size="sm" :disabled="busy" @click="signOutDevice(device)">{{ t("account.signOut") }}</Button>
          </li>
        </ul>
      </div>

      <form
        v-if="pending?.kind === 'delete'"
        class="flex flex-col gap-3 py-4"
        @submit.prevent="codeReady && run({ type: 'account-delete', code: cleanCode })"
      >
        <span class="text-muted-foreground">{{ t("account.delete.codeSent", { email: signedIn.email ?? "" }) }}</span>
        <div class="flex gap-2">
          <Input v-model="code" class="w-40 tracking-widest tabular-nums" inputmode="numeric" autocomplete="one-time-code" maxlength="7" :placeholder="t('account.code.placeholder')" :aria-label="t('account.code.label')" data-testid="account-code" />
          <Button type="submit" variant="destructive" :disabled="busy || !codeReady" data-testid="account-delete">{{ t("account.delete.confirm") }}</Button>
          <Button type="button" variant="ghost" :disabled="busy" @click="run({ type: 'account-cancel' })">{{ t("common.cancel") }}</Button>
        </div>
      </form>
      <SettingRow v-else :label="t('account.delete.label')" :description="t('account.delete.description')">
        <Button variant="destructive" :disabled="busy" data-testid="account-start-delete" @click="startDelete">{{ t("account.delete.label") }}</Button>
      </SettingRow>
      </SettingGroup>
    </template>

    <!-- Signed out, the cloud copy can still go in a folder of your own. -->
    <CloudCopySettings v-if="!signedIn" />

    <p v-if="waitingDiscord" class="text-muted-foreground mt-4" role="status" data-testid="account-discord-waiting">{{ t("account.discord.waiting") }}</p>
    <p v-if="view && !view.canKeepSignIn" class="text-muted-foreground mt-4 text-sm" data-testid="account-cant-keep">{{ t("account.cantKeep") }}</p>
  </section>
</template>
