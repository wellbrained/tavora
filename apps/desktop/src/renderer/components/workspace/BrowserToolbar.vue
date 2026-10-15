<script setup lang="ts">
// A Browser panel's toolbar. It is drawn by the host UI, above the page's
// native view, so a page can never draw over it or fake the address it shows.
import { ArrowLeft, ArrowRight, ExternalLink, Minimize2, RotateCw, ShieldCheck, ShieldOff, Users, Volume2, VolumeX, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { BrowserCommand, BrowserState } from "../../../shared/host-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { act, addressFocus, showToast } from "../../host";

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
    if (count > (previous ?? 0)) showToast("Tavora doesn't download files. Use Open in your browser to download it there.");
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
    <Button variant="ghost" size="icon-sm" aria-label="Back" title="Back (Alt+Left)" :disabled="!browser.canGoBack" data-testid="browser-back" @click="command('back')">
      <ArrowLeft :stroke-width="1.5" />
    </Button>
    <Button variant="ghost" size="icon-sm" aria-label="Forward" title="Forward (Alt+Right)" :disabled="!browser.canGoForward" data-testid="browser-forward" @click="command('forward')">
      <ArrowRight :stroke-width="1.5" />
    </Button>
    <Button v-if="browser.loading" variant="ghost" size="icon-sm" aria-label="Stop loading" title="Stop loading" data-testid="browser-stop" @click="command('stop')">
      <X :stroke-width="1.5" />
    </Button>
    <Button v-else variant="ghost" size="icon-sm" aria-label="Reload" title="Reload" :disabled="!browser.url" data-testid="browser-reload" @click="command('reload')">
      <RotateCw :stroke-width="1.5" />
    </Button>

    <form class="relative mx-1 flex min-w-0 flex-1 items-center" @submit.prevent="submit">
      <span
        v-if="browser.url && !browser.secure && !editing"
        class="text-destructive pointer-events-none absolute left-2.5 text-xs font-medium"
        data-testid="browser-not-secure"
      >Not secure</span>
      <label class="sr-only" :for="`address-${instanceId}`">Address</label>
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
        placeholder="Search or type an address"
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

    <Button v-if="browser.fullscreen" variant="ghost" size="icon-sm" aria-label="Exit full screen" title="Exit full screen (Esc)" data-testid="browser-exit-fullscreen" @click="command('exit-fullscreen')">
      <Minimize2 :stroke-width="1.5" />
    </Button>
    <Button
      v-if="browser.audible || browser.muted"
      variant="ghost"
      size="icon-sm"
      :aria-label="browser.muted ? 'Unmute' : 'Mute'"
      :title="browser.muted ? 'Unmute' : 'Mute'"
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
      :aria-label="browser.adblock ? `Ad blocking on for ${browser.site ?? 'this site'}` : `Ad blocking off for ${browser.site ?? 'this site'}`"
      :aria-pressed="browser.adblock"
      :title="
        browser.adblock
          ? `Ads blocked on this page: ${browser.blocked}. Click to allow ads on ${browser.site ?? 'this site'}.`
          : `Ads allowed on ${browser.site ?? 'this site'}. Click to block them.`
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
      :aria-label="`Signed in for all games on ${browser.site ?? 'this site'}`"
      :aria-pressed="browser.shared"
      :title="
        browser.shared
          ? `${browser.site} uses one sign-in for all games. Click to sign in per game.`
          : `Sign-ins on ${browser.site ?? 'this site'} are kept for this game only. Click to use one sign-in for all games.`
      "
      :disabled="!browser.site"
      data-testid="browser-shared"
      @click="toggleShared"
    >
      <Users :stroke-width="1.5" />
    </Button>
    <Button variant="ghost" size="icon-sm" aria-label="Open in your browser" title="Open in your browser" :disabled="!browser.url" data-testid="browser-external" @click="command('open-external')">
      <ExternalLink :stroke-width="1.5" />
    </Button>
  </div>
</template>
