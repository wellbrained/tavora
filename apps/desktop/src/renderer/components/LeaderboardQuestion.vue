<script setup lang="ts">
// Tavora's question before a module's results go public (decided 2026-10-28, main/leaderboards.ts): the content of the
// panel that called leaderboards.show, while its page waits hidden. Tavora draws it, never the module, so the module
// can't answer it or change what it says. Signed out, it offers to sign in instead; the module asks again later.
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, openProfile, state } from "../host";
import type { HostViewState } from "../../shared/host-api";
import { t } from "../i18n";
import ModuleIcon from "./ModuleIcon.vue";

const props = defineProps<{ question: NonNullable<HostViewState["pendingLeaderboard"]> }>();
const busy = ref(false);
const titleId = computed(() => `leaderboard-question-${props.question.instanceId}`);
const moduleName = computed(() => state.value?.modules.find((item) => item.id === props.question.moduleId)?.name ?? "");

async function answer(allow: boolean) {
  busy.value = true;
  await act({ type: "leaderboard-answer", id: props.question.id, allow }, { quiet: true });
  busy.value = false;
  if (allow && props.question.kind === "sign-in") openProfile("account");
}
</script>

<template>
  <section class="flex w-full max-w-[460px] flex-col gap-4" :aria-labelledby="titleId" data-testid="leaderboard-question">
    <h2 :id="titleId" class="text-lg font-semibold">{{ question.kind === "consent" ? t("leaderboards.consent.title") : t("leaderboards.signIn.title") }}</h2>
    <div class="flex items-center gap-3">
      <span class="module-tile size-10" aria-hidden="true">
        <ModuleIcon :module-id="question.moduleId" size="size-[34px]" />
      </span>
      <span class="text-sm font-medium">{{ moduleName }}</span>
    </div>
    <template v-if="question.kind === 'consent'">
      <p class="text-sm" data-testid="leaderboard-question-text">{{ t("leaderboards.consent.text", { module: moduleName, name: question.name }) }}</p>
      <p class="text-muted-foreground text-sm">{{ t("leaderboards.consent.note") }}</p>
    </template>
    <p v-else class="text-sm" data-testid="leaderboard-question-text">{{ t("leaderboards.signIn.text", { module: moduleName }) }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="secondary" autofocus data-testid="leaderboard-question-no" :disabled="busy" @click="answer(false)">{{ t("grant.notNow") }}</Button>
      <Button type="button" data-testid="leaderboard-question-yes" :disabled="busy" @click="answer(true)">
        {{ question.kind === "consent" ? t("leaderboards.consent.yes") : t("leaderboards.signIn.yes") }}
      </Button>
    </div>
  </section>
</template>
