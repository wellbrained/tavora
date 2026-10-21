<script setup lang="ts">
// Claiming a module id prefix: Check asks the catalog, and turns into Claim it when the prefix is free;
// for one that isn't, it stays Check again. Claimed, the prefix is the account's right away.
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { account, act, showToast } from "../../host";
import { t } from "../../i18n";

const props = defineProps<{ initial: string | null }>();
const emit = defineEmits<{ claimed: [prefix: string] }>();

const prefix = ref(props.initial ?? "");
watch(
  () => props.initial,
  (value) => {
    if (value && !prefix.value) prefix.value = value;
  },
);
const busy = ref(false);
const typed = computed(() => prefix.value.trim().toLowerCase());
/** What the catalog said about the prefix typed now; null until checked. */
const state = computed(() => {
  const checked = account.value?.prefixCheck;
  return checked && checked.prefix === typed.value ? checked.state : null;
});

async function press() {
  if (busy.value || !typed.value) return;
  busy.value = true;
  try {
    if (state.value === "free") {
      const claimed = typed.value;
      if ((await act({ type: "account-prefix-claim", prefix: claimed })).ok) {
        showToast(t("prefix.claimed", { prefix: claimed }));
        emit("claimed", claimed);
      }
    } else {
      await act({ type: "account-prefix-check", prefix: typed.value });
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="flex flex-col gap-1" data-testid="prefix-claim" @submit.prevent="press">
    <div class="flex gap-2">
      <Input
        v-model="prefix"
        class="max-w-60 font-mono"
        maxlength="40"
        autocomplete="off"
        spellcheck="false"
        :aria-label="t('prefix.label')"
        data-testid="prefix-input"
      />
      <Button v-if="state !== 'held'" type="submit" :variant="state === 'free' ? 'default' : 'secondary'" :disabled="busy || !typed" data-testid="prefix-button">
        {{ state === "free" ? t("prefix.claim") : state === null ? t("prefix.check") : t("prefix.checkAgain") }}
      </Button>
    </div>
    <span v-if="state" class="text-muted-foreground text-sm" role="status" data-testid="prefix-state">{{ t(`prefix.state.${state}`, { prefix: typed }) }}</span>
  </form>
</template>
