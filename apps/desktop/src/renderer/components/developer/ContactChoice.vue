<script setup lang="ts">
// How users can reach you: one choice per published module (on Your modules), or the default for the ones without
// their own (on Publishing). In Tavora is anonymous; the others show an address the developer types in, or nothing.
// A box under it says what users will see, so nobody is surprised: Nobody says plainly that nobody can write.
import { AtSign, BellOff, Eye, GitBranch, Globe, Mail, MessageSquare, Users } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { useOptimistic } from "@tavora/official-ui/optimistic";
import { CONTACT_KINDS, cleanContactValue, contactNeedsValue, type Contact, type ContactKind } from "../../../shared/conversations";
import type { MessageKey } from "../../../shared/i18n";
import { notSaved } from "../../host";
import { t } from "../../i18n";

const props = defineProps<{
  contact: Contact;
  /** The module's name, or "your modules" for the default. */
  name: string;
  /** Saves; returns an error to show, or null. */
  save: (contact: Contact) => Promise<string | null>;
  testid: string;
}>();

const ICONS = { tavora: MessageSquare, email: Mail, github: GitBranch, "discord-server": Users, "discord-user": AtSign, website: Globe, none: BellOff } as const;

const kind = ref<ContactKind>(props.contact.kind);
const value = ref(props.contact.value ?? "");
const error = ref<string | null>(null);
watch(
  () => props.contact,
  (contact) => {
    kind.value = contact.kind;
    value.value = contact.value ?? "";
  },
);

const needsValue = computed(() => contactNeedsValue(kind.value));

// A change shows as saved at once and is saved in the background; if that fails, the saved choice comes back.
const { value: saved, set: store } = useOptimistic(
  () => props.contact,
  async (next: Contact) => {
    const problem = await props.save(next);
    if (problem) throw new Error(problem);
  },
  (failure) => {
    notSaved(failure);
    // A choice without an address goes back in the box; an address stays typed, so it can be sent again.
    if (!contactNeedsValue(kind.value)) {
      kind.value = props.contact.kind;
      value.value = props.contact.value ?? "";
    }
  },
);
const unsaved = computed(() => kind.value !== saved.value.kind || (needsValue.value && value.value.trim() !== (saved.value.value ?? "")));

// A choice without an address is saved right away; one with an address waits for Save.
function pick(next: ContactKind) {
  kind.value = next;
  error.value = null;
  value.value = next === saved.value.kind ? (saved.value.value ?? "") : "";
  if (!contactNeedsValue(next) && next !== saved.value.kind) void store({ kind: next, value: null });
}

function submit() {
  const cleaned = cleanContactValue(kind.value, value.value);
  if (!cleaned) {
    error.value = t(`contactChoice.bad.${kind.value}` as MessageKey);
    return;
  }
  error.value = null;
  void store({ kind: kind.value, value: cleaned });
}

const label = (option: ContactKind) => t(`contactChoice.kind.${option}` as MessageKey);
</script>

<template>
  <div class="flex flex-col gap-2" :data-testid="testid" :data-kind="saved.kind">
    <div class="flex flex-wrap items-start gap-x-6 gap-y-2">
      <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <slot name="label" />
      </div>
      <Select :model-value="kind" @update:model-value="(next) => pick(next as ContactKind)">
        <SelectTrigger class="w-52 flex-none" :aria-label="t('contactChoice.label')" :data-testid="`${testid}-kind`">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" class="max-w-80">
          <SelectItem v-for="option in CONTACT_KINDS" :key="option" :value="option" :description="t(`contactChoice.hint.${option}` as MessageKey)" :data-testid="`${testid}-kind-${option}`">
            <template #thumb><component :is="ICONS[option]" :stroke-width="1.5" aria-hidden="true" /></template>
            {{ label(option) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
    <form v-if="needsValue" class="flex flex-wrap gap-2" @submit.prevent="submit">
      <Input
        v-model="value"
        class="max-w-96 flex-1 basis-56"
        maxlength="200"
        autocomplete="off"
        spellcheck="false"
        :inputmode="kind === 'email' ? 'email' : kind === 'discord-user' ? 'text' : 'url'"
        :placeholder="t(`contactChoice.placeholder.${kind}` as MessageKey)"
        :aria-label="label(kind)"
        :data-testid="`${testid}-value`"
      />
      <Button type="submit" variant="secondary" :disabled="!value.trim() || !unsaved" :data-testid="`${testid}-save`">{{ t("contactChoice.save") }}</Button>
    </form>
    <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
    <p class="bg-background/60 text-muted-foreground flex gap-2 rounded-lg border px-3 py-2 text-sm" :data-testid="`${testid}-says`">
      <Eye class="mt-0.5 size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
      <span>{{ t(`contactChoice.says.${kind}` as MessageKey, { name }) }}</span>
    </p>
  </div>
</template>
