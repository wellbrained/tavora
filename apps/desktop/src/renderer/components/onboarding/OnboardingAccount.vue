<script setup lang="ts">
// Screen 4: the optional account. Never a gate: Not now ends the welcome. Every line below is checked against
// the code (cloud copy to a folder works signed out; ratings, messages to developers, leaderboard ranks and
// publishing need a sign-in; the service keeps the address or Discord name, the profile and ratings; the cloud
// copy is off until turned on and encrypted on the PC, and nothing about play is sent).
import { ArrowLeft, Check, Minus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { t } from "../../i18n";

defineEmits<{ later: []; signIn: []; back: [] }>();

const WITHOUT = ["pc", "folder", "catalog"] as const;
const WITH = ["profile", "server", "rate", "messages", "ranks"] as const;
</script>

<template>
  <section class="flex w-full max-w-[640px] flex-col items-center text-center" data-testid="onboarding-account">
    <h1 class="text-3xl font-semibold">{{ t("onboarding.account.title") }}</h1>
    <p class="text-muted-foreground mt-2 mb-5 [@media(max-height:640px)]:mb-3">{{ t("onboarding.account.sub") }}</p>

    <div class="grid w-full grid-cols-2 gap-3 text-left">
      <div class="bg-card rounded-xl border p-4 max-[760px]:p-3 [@media(max-height:640px)]:p-2.5">
        <h2 class="mb-2 text-sm font-semibold">{{ t("onboarding.account.without") }}</h2>
        <ul class="flex flex-col gap-1.5 text-sm" data-testid="onboarding-without">
          <li v-for="item in WITHOUT" :key="item" class="flex items-start gap-2">
            <Minus class="text-muted-foreground mt-0.5 size-4 flex-none" :stroke-width="1.5" />
            <span>{{ t(`onboarding.account.without.${item}`) }}</span>
          </li>
        </ul>
      </div>
      <div class="bg-card rounded-xl border p-4 max-[760px]:p-3 [@media(max-height:640px)]:p-2.5">
        <h2 class="mb-2 text-sm font-semibold">{{ t("onboarding.account.with") }}</h2>
        <ul class="flex flex-col gap-1.5 text-sm" data-testid="onboarding-with">
          <li v-for="item in WITH" :key="item" class="flex items-start gap-2">
            <Check class="text-primary mt-0.5 size-4 flex-none" :stroke-width="2" />
            <span>{{ t(`onboarding.account.with.${item}`) }}</span>
          </li>
        </ul>
      </div>
    </div>
    <p class="text-muted-foreground mt-3 text-sm [@media(max-height:640px)]:mt-2" data-testid="onboarding-publish">{{ t("onboarding.account.publish") }}</p>

    <dl class="bg-muted/40 mt-3 [@media(max-height:640px)]:mt-2 flex w-full flex-col gap-2 rounded-xl p-3 text-left text-sm [@media(max-height:640px)]:gap-1 [@media(max-height:640px)]:p-2.5 [@media(max-height:640px)]:text-xs" data-testid="onboarding-keep">
      <div>
        <dt class="mr-1 inline font-medium">{{ t("onboarding.account.keep.label") }}</dt>
        <dd class="text-muted-foreground inline">{{ t("onboarding.account.keep.text") }}</dd>
      </div>
      <div>
        <dt class="mr-1 inline font-medium">{{ t("onboarding.account.cloud.label") }}</dt>
        <dd class="text-muted-foreground inline">{{ t("onboarding.account.cloud.text") }}</dd>
      </div>
      <div>
        <dt class="mr-1 inline font-medium">{{ t("onboarding.account.dont.label") }}</dt>
        <dd class="text-muted-foreground inline">{{ t("onboarding.account.dont.text") }}</dd>
      </div>
    </dl>

    <!-- Stays in reach when the window is small and the page scrolls. -->
    <div class="bg-background sticky bottom-0 mt-3 flex w-full items-center justify-center gap-3 border-t py-2">
      <Button variant="ghost" data-testid="onboarding-back" @click="$emit('back')"><ArrowLeft :stroke-width="1.5" /> {{ t("common.back") }}</Button>
      <Button variant="secondary" data-testid="onboarding-later" @click="$emit('later')">{{ t("onboarding.notNow") }}</Button>
      <Button data-testid="onboarding-sign-in" @click="$emit('signIn')">{{ t("onboarding.account.signIn") }}</Button>
    </div>
  </section>
</template>
