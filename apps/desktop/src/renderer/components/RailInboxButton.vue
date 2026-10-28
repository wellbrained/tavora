<script setup lang="ts">
// In the rail above the profile, only while the inbox is due: an open conversation, or a published module that takes
// messages. The badge counts conversations with messages not read yet.
import { Mail } from "@lucide/vue";
import { cn } from "@/lib/utils";
import { inbox, openInbox } from "../host";
import { t } from "../i18n";
import RailFooterTile from "./RailFooterTile.vue";
import RailTooltip from "./RailTooltip.vue";

defineProps<{ expanded: boolean }>();
</script>

<template>
  <RailTooltip v-if="inbox.icon" :text="t('inbox.title')" :disabled="expanded">
    <button
      type="button"
      :class="cn('group text-muted-foreground hover:text-foreground mx-2 flex items-center gap-3 rounded-lg p-1 transition-colors focus-visible:-outline-offset-2', expanded && 'hover:bg-accent')"
      data-rail-item
      data-testid="inbox-button"
      :aria-label="inbox.unread ? t('inbox.unreadCount', { count: inbox.unread }) : t('inbox.title')"
      @click="openInbox()"
    >
      <RailFooterTile>
        <Mail class="size-5" :stroke-width="1.5" />
        <span v-if="inbox.unread" class="bg-primary text-primary-foreground absolute top-0.5 right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold" data-testid="inbox-badge">{{ inbox.unread }}</span>
      </RailFooterTile>
      <span v-if="expanded" class="text-sm font-medium">{{ t("inbox.title") }}</span>
    </button>
  </RailTooltip>
</template>
