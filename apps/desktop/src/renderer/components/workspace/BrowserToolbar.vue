<script setup lang="ts">
// A Browser panel's toolbar. It is drawn by the host UI, above the page's
// native view, so a page can never draw over it or fake the address it shows.
import { ArrowLeft, ArrowRight, ExternalLink, Minimize2, RotateCw, ShieldCheck, ShieldOff, Users, Volume2, VolumeX, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { BrowserCommand, BrowserState } from "../../../shared/host-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { act, addressFocus, showToast } from "../../host";
import { t } from "../../i18n";

const props = defineProps<{ instanceId: string; browser: BrowserState }>();

const input = ref<HTMLInputElement | null>(null);
const editing = ref(false);
const draft = ref("");
const shown = computed(() => (editing.value ? draft.value : props.browser.url));

function command(command: BrowserCommand) {
  void act({ type: "browser-command", instanceId: props.instanceId, command });
}

function focusAddress() {
  draft.value = props.browser.url;
  editing.value = true;
  input.value?.focus();
  input.value?.select();
}

function submit() {
  const address = draft.value.trim();
  if (!address) return;
  editing.value = false;
  input.value?.blur();
  void act({ type: "browser-navigate", instanceId: props.instanceId, address });
}

function cancel() {
  editing.value = false;
  input.value?.blur();
}

// Ctrl+L in the page (or the host) lands here.
watch(addressFocus, (request) => request?.instanceId === props.instanceId && focusAddress());

// Downloads are refused in the main process; the player is told each time.
watch(
  () => props.browser.downloadsRefused,
  (count, previous) => {
    if (count > (previous ?? 0)) showToast(t("browser.downloadRefused"));
  },
);

function toggleShared() {
  void act({ type: "browser-set-shared", instanceId: props.instanceId, shared: !props.browser.shared });
}

function toggleAdblock() {
  void act({ type: "browser-set-adblock", instanceId: props.instanceId, enabled: !props.browser.adblock });
}
</script>

<template>
  <div class="flex h-10 flex-none items-center gap-0.5 border-b px-1.5" :data-testid="`browser-toolbar-${instanceId}`">
    <Button variant="ghost" size="icon-sm" :aria-label="t('browser.back')" :title="t('browser.backTitle')" :disabled="!browser.canGoBack" data-testid="browser-back" @click="command('back')">
      <ArrowLeft :stroke-width="1.5" />
    </Button>
    <Button variant="ghost" size="icon-sm" :aria-label="t('browser.forward')" :title="t('browser.forwardTitle')" :disabled="!browser.canGoForward" data-testid="browser-forward" @click="command('forward')">
      <ArrowRight :stroke-width="1.5" />
    </Button>
    <Button v-if="browser.loading" variant="ghost" size="icon-sm" :aria-label="t('browser.stop')" :title="t('browser.stop')" data-testid="browser-stop" @click="command('stop')">
      <X :stroke-width="1.5" />
    </Button>
    <Button v-else variant="ghost" size="icon-sm" :aria-label="t('browser.reload')" :title="t('browser.reload')" :disabled="!browser.url" data-testid="browser-reload" @click="command('reload')">
      <RotateCw :stroke-width="1.5" />
    </Button>

    <form class="relative mx-1 flex min-w-0 flex-1 items-center" @submit.prevent="submit">
      <span
        v-if="browser.url && !browser.secure && !editing"
        class="text-destructive pointer-events-none absolute left-2.5 text-xs font-medium"
        data-testid="browser-not-secure"
      >{{ t("browser.notSecure") }}</span>
      <label class="sr-only" :for="`address-${instanceId}`">{{ t("browser.address") }}</label>
      <input
        :id="`address-${instanceId}`"
        ref="input"
        :value="shown"
        :class="
          cn(
            'bg-muted/60 focus-visible:ring-ring/50 placeholder:text-muted-foreground h-7 w-full min-w-0 rounded-md border border-transparent px-2.5 text-sm outline-none focus-visible:ring-2',
            browser.url && !browser.secure && !editing && 'pl-[5.25rem]',
          )
        "
        :placeholder="t('browser.addressPlaceholder')"
        spellcheck="false"
        autocomplete="off"
        :data-testid="`browser-address-${instanceId}`"
        :title="browser.host"
        @focus="!editing && focusAddress()"
        @input="draft = ($event.target as HTMLInputElement).value"
        @blur="editing = false"
        @keydown.esc.prevent="cancel"
      />
    </form>

    <Button v-if="browser.fullscreen" variant="ghost" size="icon-sm" :aria-label="t('browser.exitFullscreen')" :title="t('browser.exitFullscreenTitle')" data-testid="browser-exit-fullscreen" @click="command('exit-fullscreen')">
      <Minimize2 :stroke-width="1.5" />
    </Button>
    <Button
      v-if="browser.audible || browser.muted"
      variant="ghost"
      size="icon-sm"
      :aria-label="browser.muted ? t('browser.unmute') : t('browser.mute')"
      :title="browser.muted ? t('browser.unmute') : t('browser.mute')"
      data-testid="browser-mute"
      @click="command(browser.muted ? 'unmute' : 'mute')"
    >
      <VolumeX v-if="browser.muted" :stroke-width="1.5" />
      <Volume2 v-else :stroke-width="1.5" />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      :class="cn(browser.adblock ? 'text-success' : 'text-muted-foreground', 'relative')"
      :aria-label="browser.adblock ? t('browser.adblockOn', { site: browser.site ?? t('browser.thisSite') }) : t('browser.adblockOff', { site: browser.site ?? t('browser.thisSite') })"
      :aria-pressed="browser.adblock"
      :title="
        browser.adblock
          ? t('browser.adblockOnTitle', { blocked: browser.blocked, site: browser.site ?? t('browser.thisSite') })
          : t('browser.adblockOffTitle', { site: browser.site ?? t('browser.thisSite') })
      "
      :disabled="!browser.site"
      data-testid="browser-adblock"
      :data-blocked="browser.blocked"
      @click="toggleAdblock"
    >
      <ShieldCheck v-if="browser.adblock" :stroke-width="1.5" />
      <ShieldOff v-else :stroke-width="1.5" />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      :class="browser.shared ? 'text-primary' : 'text-muted-foreground'"
      :aria-label="t('browser.sharedLabel', { site: browser.site ?? t('browser.thisSite') })"
      :aria-pressed="browser.shared"
      :title="
        browser.shared
          ? t('browser.sharedOnTitle', { site: browser.site ?? t('browser.thisSite') })
          : t('browser.sharedOffTitle', { site: browser.site ?? t('browser.thisSite') })
      "
      :disabled="!browser.site"
      data-testid="browser-shared"
      @click="toggleShared"
    >
      <Users :stroke-width="1.5" />
    </Button>
    <Button variant="ghost" size="icon-sm" :aria-label="t('browser.external')" :title="t('browser.external')" :disabled="!browser.url" data-testid="browser-external" @click="command('open-external')">
      <ExternalLink :stroke-width="1.5" />
    </Button>
  </div>
</template>
