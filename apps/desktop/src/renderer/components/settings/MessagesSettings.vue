<script setup lang="ts">
// Profile dialog > Messages: the email copy switch, and the conversations that are closed (they leave the inbox
// icon but stay readable here).
import { computed } from "vue";
import { AnimatedList } from "@tavora/official-ui/components/ui/animated-list";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { useOptimistic } from "@tavora/official-ui/optimistic";
import { act, inbox, notSaved, openInbox, savedBy } from "../../host";
import { developerNameOf, type ConversationItem } from "../../../shared/conversations";
import { formatDate, t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

const copies = computed(() => inbox.value.emailCopies);
const closed = computed(() => (inbox.value.items ?? []).filter((item) => item.state === "closed"));
// The switch moves at once; the service hears about it in the background, and it goes back if that fails.
const { value: copiesOn, set: setCopies } = useOptimistic(() => copies.value?.on ?? false, savedBy((on: boolean) => ({ type: "inbox-email-copies", on })), (error) => {
  notSaved(error);
  // The request may have landed although the answer was lost.
  void act({ type: "inbox-refresh" }, { quiet: true });
});

function title(item: ConversationItem): string {
  if (item.kind === "tavora") return t("inbox.tavora");
  if (item.role === "developer") return `${item.module?.name ?? ""} · ${t("inbox.userLabel", { label: item.label })}`;
  const name = developerNameOf(item);
  return name ? t("inbox.developerOf", { module: item.module?.name ?? "", name }) : t("inbox.developerOfNoName", { module: item.module?.name ?? "" });
}
</script>

<template>
  <SettingGroup v-if="inbox.active" :title="t('messagesSettings.title')" :description="t('messagesSettings.description')" data-testid="account-messages">
    <SettingRow :label="t('messagesSettings.copies')" :description="copies && !copies.hasEmail ? t('messagesSettings.noEmail') : t('messagesSettings.copiesHint')">
      <Switch :model-value="copiesOn" :disabled="!copies || !copies.hasEmail" :aria-label="t('messagesSettings.copies')" data-testid="messages-email-copies" @update:model-value="setCopies" />
    </SettingRow>
    <div class="-mx-5 border-b px-5 py-4 last:border-b-0">
      <h4 class="text-sm font-medium">{{ t("messagesSettings.closed") }}</h4>
      <p v-if="!closed.length" class="text-muted-foreground mt-1 text-sm" data-testid="messages-closed-none">{{ t("messagesSettings.closedNone") }}</p>
      <AnimatedList tag="ul" v-else class="mt-2" data-testid="messages-closed">
        <li v-for="item in closed" :key="item.id" class="flex min-h-12 items-center gap-3 py-1" :data-testid="`messages-closed-${item.id}`">
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate">{{ title(item) }}</span>
            <span class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              <Badge v-if="item.type" variant="secondary">{{ t(`contact.type.${item.type}`) }}</Badge>
              {{ formatDate(item.closedAt ?? item.lastMessageAt) }}
            </span>
          </span>
          <Button variant="ghost" size="sm" @click="openInbox(item.id)">{{ t("messagesSettings.open") }}</Button>
        </li>
      </AnimatedList>
    </div>
  </SettingGroup>
</template>
