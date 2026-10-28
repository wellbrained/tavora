<script setup lang="ts">
// In the workspace header, only while the inbox icon is due: an open conversation, or a published module that takes
// messages. The badge counts conversations with messages not read yet.
import { Mail } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { inbox, openInbox } from "../../host";
import { t } from "../../i18n";
</script>

<template>
  <Button v-if="inbox.icon" size="icon-sm" variant="ghost" class="relative" :title="t('inbox.title')" :aria-label="inbox.unread ? t('inbox.unreadCount', { count: inbox.unread }) : t('inbox.title')" data-testid="inbox-button" @click="openInbox()">
    <Mail :stroke-width="1.5" />
    <span v-if="inbox.unread" class="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold" data-testid="inbox-badge">{{ inbox.unread }}</span>
  </Button>
</template>
