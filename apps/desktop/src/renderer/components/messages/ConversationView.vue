<script setup lang="ts">
// One conversation: who it is with, the messages as plain text, a reply box while it is open, and Close, Block,
// Report and Delete. A closed conversation is read-only and says why. Nothing the service sent is shown as markup.
import { computed, nextTick, ref, watch } from "vue";
import { Ban, Flag, Trash2, X } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { developerNameOf, MAX_MESSAGE_LENGTH, messageProblem, type ConversationDetail, type ConversationItem, type ConversationMessage } from "../../../shared/conversations";
import { act, api, confirmAction, inbox, submitAction } from "../../host";
import { formatDate, t } from "../../i18n";
import CloseConversationDialog from "./CloseConversationDialog.vue";
import ReportConversationDialog from "./ReportConversationDialog.vue";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ gone: []; select: [id: string]; again: [item: ConversationItem] }>();

const detail = ref<ConversationDetail | null>(null);
const failure = ref<string | null>(null);
const text = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const closing = ref(false);
const reporting = ref(false);
const thread = ref<HTMLElement | null>(null);

const item = computed(() => detail.value?.conversation ?? null);
const open = computed(() => item.value?.state === "open");
const problem = computed(() => messageProblem(text.value));
const length = computed(() => [...text.value.trim()].length);
const previous = computed(() => (item.value?.previousId ? (inbox.value.items ?? []).find((other) => other.id === item.value!.previousId) : undefined));

/** The other side as the viewer sees it. The service names them in English; the app words them in the user's language. */
function titleOf(conversation: ConversationItem): string {
  if (conversation.kind === "tavora") return t("inbox.tavora");
  if (conversation.role === "developer") return t("inbox.userLabel", { label: conversation.label });
  const developer = developerNameOf(conversation);
  const module = conversation.module?.name ?? "";
  return developer ? t("inbox.developerOf", { module, name: developer }) : t("inbox.developerOfNoName", { module });
}
function author(message: ConversationMessage): string {
  if (message.mine) return t("inbox.you");
  if (message.from === "tavora") return t("inbox.tavora");
  return item.value ? titleOf(item.value) : "";
}

/** Why a closed conversation is closed, in a line. */
function closedLine(conversation: ConversationItem): string {
  const reason = conversation.closeReason ?? "none";
  if (reason === "user") return conversation.role === "user" ? t("inbox.closed.user") : t("inbox.closed.userOther");
  if (reason === "blocked") return t("inbox.closed.blocked");
  if (reason === "timeout") return t("inbox.closed.timeout");
  if (reason === "tavora") return t("inbox.closed.tavora");
  if (reason === "left") return t("inbox.closed.left");
  return t(`inbox.closed.${reason}`);
}

async function load() {
  const result = await api.conversation(props.id);
  if (result.status === "ok") {
    detail.value = result;
    failure.value = null;
    await nextTick();
    thread.value?.scrollTo({ top: thread.value.scrollHeight });
  } else {
    failure.value = result.error;
  }
}
watch(
  () => props.id,
  () => {
    detail.value = null;
    failure.value = null;
    text.value = "";
    error.value = null;
    void load();
  },
  { immediate: true },
);
// A new message arrived while it is open (the inbox view refreshes now and then).
watch(
  () => (inbox.value.items ?? []).find((other) => other.id === props.id)?.lastMessageAt,
  (at) => {
    if (at && detail.value && at !== detail.value.conversation.lastMessageAt) void load();
  },
);

async function send() {
  if (problem.value || busy.value) return;
  busy.value = true;
  error.value = null;
  const result = await act({ type: "inbox-reply", id: props.id, text: text.value.trim() }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  text.value = "";
  await load();
}

function closeOwn() {
  if (item.value?.role === "developer") {
    closing.value = true;
    return;
  }
  confirmAction({
    title: t("inbox.close.title"),
    message: t("inbox.close.message"),
    confirm: t("inbox.close"),
    run: async () => {
      const failed = await submitAction({ type: "inbox-close", id: props.id });
      if (!failed) await load();
      return failed;
    },
  });
}

function block() {
  confirmAction({
    title: t("inbox.block.title"),
    message: t("inbox.block.message"),
    confirm: t("inbox.block"),
    danger: true,
    run: async () => {
      const failed = await submitAction({ type: "inbox-block", id: props.id, report: null });
      if (!failed) await load();
      return failed;
    },
  });
}

function remove() {
  confirmAction({
    title: t("inbox.delete.title"),
    message: t("inbox.delete.message"),
    confirm: t("inbox.delete"),
    danger: true,
    run: async () => {
      const failed = await submitAction({ type: "inbox-delete", id: props.id });
      if (!failed) emit("gone");
      return failed;
    },
  });
}

async function afterChange() {
  await load();
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="conversation">
    <p v-if="failure" class="text-destructive p-6 text-sm" role="alert">{{ failure }}</p>
    <p v-else-if="!item" class="text-muted-foreground p-6 text-sm" role="status">{{ t("contact.loading") }}</p>
    <template v-else>
      <header class="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <div class="min-w-0 flex-1">
          <h3 class="truncate font-medium" data-testid="conversation-title">{{ titleOf(item) }}</h3>
          <p class="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
            <Badge v-if="item.type" variant="secondary">{{ t(`contact.type.${item.type}`) }}</Badge>
            <Badge :variant="open ? 'success' : 'outline'" data-testid="conversation-state">{{ open ? t("inbox.state.open") : t("inbox.state.closed") }}</Badge>
            <span v-if="item.module">{{ item.module.name }}</span>
          </p>
        </div>
        <div class="flex flex-none flex-wrap gap-1">
          <Button v-if="open && item.kind === 'developer'" size="sm" variant="ghost" data-testid="conversation-close" @click="closeOwn"><X :stroke-width="1.5" /> {{ t("inbox.close") }}</Button>
          <Button v-if="item.kind === 'developer'" size="sm" variant="ghost" data-testid="conversation-block" :disabled="!open" @click="block"><Ban :stroke-width="1.5" /> {{ t("inbox.block") }}</Button>
          <Button v-if="item.kind === 'developer'" size="sm" variant="ghost" data-testid="conversation-report" @click="reporting = true"><Flag :stroke-width="1.5" /> {{ t("inbox.report") }}</Button>
          <Button size="sm" variant="ghost" data-testid="conversation-delete" @click="remove"><Trash2 :stroke-width="1.5" /> {{ t("inbox.delete") }}</Button>
        </div>
      </header>

      <div ref="thread" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" data-testid="conversation-messages">
        <p v-if="previous" class="text-muted-foreground text-xs">
          {{ t("inbox.follows") }}
          <Button variant="link" size="sm" class="h-auto p-0 text-xs" @click="emit('select', previous.id)">{{ t("inbox.showEarlier") }}</Button>
        </p>
        <p v-else-if="item.previousId" class="text-muted-foreground text-xs">{{ t("inbox.follows") }}</p>
        <div v-for="message in detail!.messages" :key="message.id" class="flex flex-col gap-1" :class="message.mine ? 'items-end' : 'items-start'" :data-testid="`message-${message.id}`">
          <span class="text-muted-foreground text-xs">{{ author(message) }} · {{ formatDate(message.at, { dateStyle: "medium", timeStyle: "short" }) }}</span>
          <p class="max-w-[85%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap" :class="message.mine ? 'bg-primary/15' : 'bg-muted'">{{ message.text }}</p>
          <span v-if="message.versions" class="text-muted-foreground text-xs">{{ t("inbox.versions", { tavora: message.versions.tavora, module: message.versions.module }) }}</span>
        </div>
      </div>

      <footer class="border-t px-5 py-4">
        <p v-if="open && item.closesInDays" class="text-warning mb-2 text-xs" role="status" data-testid="conversation-closes-in">{{ t("inbox.closesIn", { count: item.closesInDays }) }}</p>
        <form v-if="open" class="grid gap-2" @submit.prevent="send">
          <Textarea v-model="text" class="min-h-20 text-sm" :placeholder="t('inbox.reply.placeholder')" :aria-label="t('inbox.reply.placeholder')" :disabled="busy" data-testid="conversation-reply" />
          <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="conversation-error">{{ error }}</p>
          <div class="flex items-center justify-end gap-3">
            <span class="text-muted-foreground text-xs" :class="length > MAX_MESSAGE_LENGTH && 'text-destructive'">{{ length }} / {{ MAX_MESSAGE_LENGTH }}</span>
            <Button type="submit" size="sm" :disabled="busy || problem !== null" data-testid="conversation-send">{{ t("inbox.reply.send") }}</Button>
          </div>
        </form>
        <div v-else class="flex flex-wrap items-center gap-3" data-testid="conversation-closed">
          <p class="text-muted-foreground text-sm">{{ closedLine(item) }}</p>
          <Button v-if="item.kind === 'developer' && item.role === 'user' && item.module && item.closeReason !== 'blocked' && item.closeReason !== 'left'" size="sm" variant="secondary" data-testid="conversation-again" @click="emit('again', item)">
            {{ t("inbox.again") }}
          </Button>
        </div>
      </footer>
    </template>

    <CloseConversationDialog v-if="closing" :id="id" @close="closing = false" @done="afterChange" />
    <ReportConversationDialog v-if="reporting" :id="id" :can-block="open" @close="reporting = false" @done="afterChange" />
  </div>
</template>
