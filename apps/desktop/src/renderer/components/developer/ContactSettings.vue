<script setup lang="ts">
// Settings > Development > Messages from users: per published module, whether users can write to the developer in
// Tavora, and an optional public https link to show instead when it is off. Contact is on by default, so a module
// with it on is one short line: its name and the switch; only one turned off says so.
import { computed, onMounted, reactive, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { act, inbox, showToast } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "../settings/SettingGroup.vue";

const contacts = computed(() => inbox.value.contacts);
const links = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
const busy = ref(false);

onMounted(() => void act({ type: "inbox-refresh" }, { quiet: true }));

function link(id: string): string {
  return links[id] ?? contacts.value?.find((contact) => contact.id === id)?.link ?? "";
}

async function save(id: string, enabled: boolean, text: string) {
  busy.value = true;
  errors[id] = "";
  const result = await act({ type: "inbox-contact", moduleId: id, enabled, link: text.trim() || null }, { quiet: true });
  busy.value = false;
  if (!result.ok) errors[id] = result.error;
  else {
    delete links[id];
    showToast(t("contactSettings.saved"));
  }
}
</script>

<template>
  <SettingGroup v-if="contacts" :title="t('contactSettings.title')" :description="t('contactSettings.description')">
    <p v-if="!contacts.length" class="text-muted-foreground py-4 text-sm" data-testid="contact-settings-none">{{ t("contactSettings.none") }}</p>
    <div v-for="contact in contacts" :key="contact.id" class="-mx-5 flex flex-col gap-3 border-b px-5 py-3 last:border-b-0" :data-testid="`contact-setting-${contact.id}`">
      <div class="flex items-center gap-4">
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{{ contact.name }}</p>
          <p v-if="!contact.enabled" class="text-muted-foreground text-sm">{{ t("contactSettings.off") }}</p>
        </div>
        <Switch :model-value="contact.enabled" :disabled="busy" :aria-label="t('contactSettings.switch', { name: contact.name })" :data-testid="`contact-switch-${contact.id}`" @update:model-value="(value: boolean) => save(contact.id, value, link(contact.id))" />
      </div>
      <form v-if="!contact.enabled" class="flex flex-col gap-1" @submit.prevent="save(contact.id, false, link(contact.id))">
        <div class="flex gap-2">
          <Input :model-value="link(contact.id)" class="max-w-96" maxlength="200" inputmode="url" autocomplete="off" spellcheck="false" :placeholder="t('contactSettings.link')" :aria-label="t('contactSettings.link')" :data-testid="`contact-link-${contact.id}`" @update:model-value="(value: string | number) => (links[contact.id] = String(value))" />
          <Button type="submit" variant="secondary" :disabled="busy || link(contact.id) === (contact.link ?? '')" :data-testid="`contact-link-save-${contact.id}`">{{ t("contactSettings.saveLink") }}</Button>
        </div>
        <span class="text-muted-foreground text-xs">{{ t("contactSettings.linkHint") }}</span>
      </form>
      <p v-if="errors[contact.id]" class="text-destructive text-sm" role="alert">{{ errors[contact.id] }}</p>
    </div>
  </SettingGroup>
</template>
