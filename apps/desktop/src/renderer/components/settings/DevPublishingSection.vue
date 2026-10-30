<script setup lang="ts">
// Settings > Publishing: what a developer sets once to share modules in the catalog (ModuleDeveloperSettings): the
// recovery key when this PC needs it, the developer name and id prefix, how users reach them by default, and the keys and tokens for a build server. It needs
// the account; signed out, the page says so.
import { computed, onMounted } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { account, act, developerKeys, openSettings } from "../../host";
import { t } from "../../i18n";
import ModuleDeveloperSettings from "../developer/ModuleDeveloperSettings.vue";
import RecoveryKeySettings from "./RecoveryKeySettings.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

/** Publishing needs the account; in builds without accounts there is none of it. */
const accounts = computed(() => account.value?.enabled === true);
/** The account's recovery key is on screen (made with a key here) or needed on this PC: it comes first. */
const recoveryKey = computed(() => Boolean(developerKeys.value?.recoveryKey) || developerKeys.value?.status === "ask");

onMounted(() => {
  // The developer side and the contact default as the service has them now; quietly, offline is fine.
  if (account.value?.account) {
    void act({ type: "account-refresh" }, { quiet: true });
    void act({ type: "inbox-refresh" }, { quiet: true });
  }
});
</script>

<template>
  <template v-if="accounts && account?.account">
    <RecoveryKeySettings v-if="recoveryKey" />
    <ModuleDeveloperSettings :highlight="highlight" />
  </template>
  <SettingGroup v-else-if="accounts">
    <SettingRow :label="t('settings.dev-publishing.signIn')" :description="t('settings.dev-publishing.signInHint')">
      <Button data-testid="dev-publishing-sign-in" @click="openSettings({ section: 'account' })">{{ t("catalog.reviews.signInButton") }}</Button>
    </SettingRow>
  </SettingGroup>
  <p v-else class="text-muted-foreground text-sm" data-testid="dev-publishing-none">{{ t("settings.dev-publishing.none") }}</p>
</template>
