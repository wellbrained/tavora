<script setup lang="ts">
// The inbox: every conversation the account has, grouped by module with its type and state, and the one picked.
// Opened from the header icon, or from Settings > Account > Messages for a closed one.
import { computed, ref, watch } from "vue";
import { X } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { groupConversations, type ConversationItem } from "../../../shared/conversations";
import { inbox, inboxOpen } from "../../host";
import { t } from "../../i18n";
import ContactDeveloperDialog from "./ContactDeveloperDialog.vue";
import ConversationView from "./ConversationView.vue";
import NoteText from "./NoteText.vue";

const selected = ref<string | null>(inboxOpen.value?.id ?? null);
const why = ref(false);
const again = ref<ConversationItem | null>(null);

const groups = computed(() => groupConversations(inbox.value.items ?? []));
const empty = computed(() => (inbox.value.items ?? []).length === 0);

// Without a pick, the first one with news (or the newest) is shown.
watch(
  () => inbox.value.items,
  (items) => {
    if (selected.value || !items?.length) return;
    selected.value = items.find((item) => item.unread)?.id ?? groups.value.flatMap((group) => group.items)[0]?.id ?? null;
  },
  { immediate: true },
);

function stateLabel(item: ConversationItem): string {
  return item.state === "open" ? t("inbox.state.open") : t("inbox.state.closed");
}
function heading(group: ReturnType<typeof groupConversations>[number]): string {
  return group.module ? group.module.name : t("inbox.tavora");
}
function itemTitle(item: ConversationItem): string {
  if (item.kind === "tavora") return t("inbox.tavora");
  return item.role === "developer" ? t("inbox.userLabel", { label: item.label }) : (item.module?.name ?? "");
}
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && (inboxOpen = null)">
    <DialogContent class="bg-card top-[calc(50%+env(titlebar-area-height,0px)/2)] flex h-[min(880px,calc(100vh-env(titlebar-area-height,0px)-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid="inbox" :show-close-button="false">
      <header class="flex items-start gap-3 border-b px-5 py-4">
        <div class="min-w-0 flex-1">
          <DialogTitle class="text-lg font-semibold">{{ t("inbox.title") }}</DialogTitle>
          <DialogDescription class="text-muted-foreground text-sm">
            <Button variant="link" size="sm" class="h-auto p-0 text-sm" :aria-expanded="why" data-testid="inbox-why-toggle" @click="why = !why">{{ t("inbox.why") }}</Button>
          </DialogDescription>
          <div v-if="why" class="text-muted-foreground mt-2 max-w-prose space-y-2 text-sm" data-testid="inbox-why">
            <NoteText v-if="inbox.why" :paragraphs="inbox.why" />
            <p v-else>{{ t("inbox.whyDeveloper") }}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" :aria-label="t('common.close')" @click="inboxOpen = null"><X class="size-4" /></Button>
      </header>

      <div v-if="empty" class="text-muted-foreground grid flex-1 place-items-center p-6 text-sm" data-testid="inbox-empty">{{ t("inbox.empty") }}</div>
      <div v-else class="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
        <nav class="overflow-y-auto border-r py-2" :aria-label="t('inbox.title')" data-testid="inbox-list">
          <section v-for="group in groups" :key="group.key" class="mb-2">
            <h3 class="text-muted-foreground px-4 py-1 text-xs font-semibold tracking-wider uppercase">{{ heading(group) }}</h3>
            <ul>
              <li v-for="item in group.items" :key="item.id">
                <button type="button" class="hover:bg-muted/60 focus-visible:ring-ring flex w-full flex-col gap-1 px-4 py-2 text-left outline-none focus-visible:ring-2" :class="item.id === selected && 'bg-muted'" :aria-current="item.id === selected || undefined" :data-testid="`inbox-item-${item.id}`" @click="selected = item.id">
                  <span class="flex items-center gap-2">
                    <span class="truncate text-sm" :class="item.unread && 'font-semibold'">{{ itemTitle(item) }}</span>
                    <span v-if="item.unread" class="bg-primary size-2 flex-none rounded-full" :aria-label="t('inbox.unread')" />
                  </span>
                  <span class="flex flex-wrap gap-1.5">
                    <Badge v-if="item.type" variant="secondary">{{ t(`contact.type.${item.type}`) }}</Badge>
                    <Badge :variant="item.state === 'open' ? 'success' : 'outline'">{{ stateLabel(item) }}</Badge>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </nav>
        <ConversationView v-if="selected" :id="selected" :key="selected" @gone="selected = null" @select="(id: string) => (selected = id)" @again="(item: ConversationItem) => (again = item)" />
        <div v-else class="text-muted-foreground grid place-items-center p-6 text-sm">{{ t("inbox.select") }}</div>
      </div>
    </DialogContent>
    <ContactDeveloperDialog v-if="again?.module" :module-id="again.module.id" :module-name="again.module.name" :previous-id="again.id" @close="again = null" />
  </Dialog>
</template>
