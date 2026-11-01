<script setup lang="ts">
// First-run welcome, in place of Home until it is finished or skipped. Four short screens: 1) a map of the
// app (workspace, panel, module), 2) what to try first, 3) the start (a game, or a personal space), 4) the
// optional account. Skip is on every screen and counts as done. Settings > General can show it again.
import { nextTick, ref, watch } from "vue";
import { cn } from "@/lib/utils";
import { act, openPanels, openProfile, profileOpen, trialWelcome } from "../host";
import { t } from "../i18n";
import OnboardingAccount from "../components/onboarding/OnboardingAccount.vue";
import OnboardingChoice, { type FirstChoice } from "../components/onboarding/OnboardingChoice.vue";
import OnboardingGame, { type StartedGame } from "../components/onboarding/OnboardingGame.vue";
import OnboardingMap from "../components/onboarding/OnboardingMap.vue";
import OnboardingPersonal, { type StartedPersonal } from "../components/onboarding/OnboardingPersonal.vue";

/** `dry`: the welcome is only tried (dev build): every action is pretended and nothing is written. */
const props = defineProps<{ dry?: boolean }>();

const STEPS = ["map", "choice", "start", "account"] as const;

const step = ref(0);
/** Which way the steps slide. */
const forward = ref(true);
const choice = ref<FirstChoice | null>(null);
/** What screen 3 made; opened when the welcome ends. */
const game = ref<StartedGame | null>(null);
const personal = ref<StartedPersonal | null>(null);

function go(to: number) {
  forward.value = to > step.value;
  step.value = to;
}

function pick(kind: FirstChoice) {
  // Another pick than the one made before leaves the earlier one in the library, as a workspace made by hand would stay.
  choice.value = kind;
  go(2);
}

/** Ends the welcome: lands in the workspace made here, if any, with its panels open, and never shows the welcome again. */
async function finish() {
  // A dry run writes nothing: it just closes, and the library is as it was.
  if (props.dry) {
    trialWelcome.value = false;
    return;
  }
  const started = choice.value === "personal" ? personal.value : choice.value === "game" ? game.value : null;
  if (started) {
    const opened = await act({ type: "open-workspace", workspaceId: started.id });
    if (opened.ok) {
      await act({ type: "set-onboarded", done: true });
      for (const moduleId of started.moduleIds) {
        await nextTick();
        await openPanels(moduleId, null, []);
      }
      return;
    }
  }
  await act({ type: "set-onboarded", done: true });
}

// Sign in opens the account over the welcome; it ends when that closes, signed in or not.
const signingIn = ref(false);
function signIn() {
  // A dry run does not open the real sign-in.
  if (props.dry) return void finish();
  signingIn.value = true;
  openProfile("account");
}
watch(profileOpen, (open) => {
  if (!open && signingIn.value) {
    signingIn.value = false;
    void finish();
  }
});
</script>

<template>
  <main class="relative flex h-full flex-col items-center overflow-y-auto px-8 py-8 max-[760px]:px-4 [@media(max-height:640px)]:pt-10 [@media(max-height:640px)]:pb-4" data-testid="onboarding">
    <p v-if="dry" class="bg-warning/15 text-warning absolute top-4 left-6 rounded-md px-2 py-1 text-xs" data-testid="onboarding-dry">{{ t("onboarding.dry") }}</p>
    <!-- Skips the whole welcome. -->
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground app-no-drag absolute top-4 right-6 z-10 rounded-md px-2 py-1 text-sm"
      data-testid="onboarding-skip"
      @click="finish"
    >
      {{ t("onboarding.skip") }}
    </button>

    <!-- Centred in the window; the step area keeps one height, so the dots and titles don't jump between steps. A
         taller step pushes it to the top and scrolls. -->
    <div class="my-auto flex w-full flex-col items-center">
      <!-- Step dots -->
      <ol class="mb-8 flex flex-none items-center gap-2 [@media(max-height:640px)]:mb-4" :aria-label="t('onboarding.steps')">
        <li v-for="(label, index) in STEPS" :key="label" class="flex items-center gap-2">
          <span
            :class="cn('h-1.5 rounded-full transition-[width,background-color] duration-(--duration-move) ease-(--ease-in-out-strong)', index === step ? 'bg-primary w-8' : index < step ? 'bg-primary/50 w-3' : 'bg-muted w-3')"
            :aria-current="index === step ? 'step' : undefined"
            :aria-label="t(`onboarding.step.${label}`)"
          />
        </li>
      </ol>

      <div class="flex min-h-[460px] w-full flex-col items-center [@media(max-height:640px)]:min-h-0">
        <Transition :name="forward ? 'step-forward' : 'step-back'" mode="out-in">
          <OnboardingMap v-if="step === 0" key="map" @next="go(1)" />
          <OnboardingChoice v-else-if="step === 1" key="choice" @pick="pick" @back="go(0)" />
          <OnboardingGame v-else-if="step === 2 && choice === 'game'" key="game" :started="game" :dry="dry" @start="game = $event" @next="go(3)" @back="go(1)" />
          <OnboardingPersonal v-else-if="step === 2" key="personal" :started="personal" :dry="dry" @start="personal = $event" @next="go(3)" @back="go(1)" />
          <OnboardingAccount v-else key="account" @later="finish" @sign-in="signIn" @back="go(2)" />
        </Transition>
      </div>
    </div>
  </main>
</template>

<style scoped>
.step-forward-enter-active,
.step-forward-leave-active,
.step-back-enter-active,
.step-back-leave-active {
  transition:
    opacity var(--duration-menu) var(--ease-out-strong),
    transform var(--duration-menu) var(--ease-out-strong);
}
.step-forward-enter-from,
.step-back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
.step-forward-leave-to,
.step-back-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
</style>
