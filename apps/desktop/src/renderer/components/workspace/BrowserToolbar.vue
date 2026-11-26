<script setup lang="ts">
// A Browser panel's toolbar. It is drawn by the host UI, above the page's
// native view, so a page can never draw over it or fake the address it shows.
import { ArrowLeft, ArrowRight, ExternalLink, Minimize2, Plus, RotateCw, ShieldCheck, ShieldOff, Users, Volume2, VolumeX, X } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import type { BrowserCommand, BrowserState } from "../../../shared/host-api";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { cn } from "@tavora/official-ui/lib/utils";
import { act, addressFocus, showToast } from "../../host";
import { t } from "../../i18n";
import { keyInput, shortcutIn } from "../../../shared/shortcuts";
import { keyshortcuts, MAC } from "../../shortcuts";

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

// Ctrl+L in the page (or the host) lands here, and so does a new tab, whose
// request can arrive before this toolbar is mounted.
function takeFocusRequest() {
  if (addressFocus.value?.instanceId !== props.instanceId) return;
  addressFocus.value = null;
  focusAddress();
}
watch(addressFocus, takeFocusRequest);
onMounted(takeFocusRequest);

function newTab() {
  void act({ type: "browser-new-tab", instanceId: props.instanceId });
}

// The same tab keys as in the page, for when the toolbar has the focus.
function onKeydown(event: KeyboardEvent) {
  const shortcut = shortcutIn("browser", keyInput(event), MAC);
  if (shortcut === "browser.new-tab") newTab();
  else if (shortcut === "browser.close-tab") void act({ type: "close-panel", instanceId: props.instanceId });
  else return;
  event.preventDefault();
}

// Downloads are refused in the main process; the user is told each time.
watch(
  () => props.browser.downloadsRefused,
  (count, previous) => {
    if (count > (previous ?? 0)) showToast(t("browser.downloadRefused"));
  },
);

// While the panel asks about another site, the site buttons stay off: they would act on the site asked about.
const siteButtonsOff = computed(() => !props.browser.site || props.browser.error?.kind === "otherSession");

function toggleShared() {
  void act({ type: "browser-set-shared", instanceId: props.instanceId, shared: !props.browser.shared });
}

function toggleAdblock() {
  void act({ type: "browser-set-adblock", instanceId: props.instanceId, enabled: !props.browser.adblock });
}
</script>

<template>
  <div class="flex h-10 flex-none items-center gap-0.5 border-b px-1.5" :data-testid="`browser-toolbar-${instanceId}`" @keydown="onKeydown">
    <Button variant="ghost" size="icon-sm" :aria-label="t('browser.back')" :title="t('browser.back')" :aria-keyshortcuts="keyshortcuts('browser.back')" :disabled="!browser.canGoBack" data-testid="browser-back" @click="command('back')">
      <ArrowLeft />
    </Button>
    <Button variant="ghost" size="icon-sm" :aria-label="t('browser.forward')" :title="t('browser.forward')" :aria-keyshortcuts="keyshortcuts('browser.forward')" :disabled="!browser.canGoForward" data-testid="browser-forward" @click="command('forward')">
      <ArrowRight />
    </Button>
    <Button v-if="browser.loading" variant="ghost" size="icon-sm" :aria-label="t('browser.stop')" :title="t('browser.stop')" data-testid="browser-stop" @click="command('stop')">
      <X />
    </Button>
    <Button v-else variant="ghost" size="icon-sm" :aria-label="t('browser.reload')" :title="t('browser.reload')" :disabled="!browser.url" data-testid="browser-reload" @click="command('reload')">
      <RotateCw />
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

    <Button v-if="browser.fullscreen" variant="ghost" size="icon-sm" :aria-label="t('browser.exitFullscreen')" :title="t('browser.exitFullscreen')" :aria-keyshortcuts="keyshortcuts('browser.leave-fullscreen')" data-testid="browser-exit-fullscreen" @click="command('exit-fullscreen')">
      <Minimize2 />
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
      <VolumeX v-if="browser.muted" />
      <Volume2 v-else />
    </Button>
    <Toggle
      variant="ghost"
      size="sm"
      class="data-[state=on]:bg-success/15 data-[state=on]:text-success data-[state=on]:hover:bg-success/20 data-[state=on]:hover:text-success relative"
      :label="browser.adblock ? t('browser.adblockOn', { site: browser.site ?? t('browser.thisSite') }) : t('browser.adblockOff', { site: browser.site ?? t('browser.thisSite') })"
      :model-value="browser.adblock"
      :title="
        browser.adblock
          ? t('browser.adblockOnTitle', { blocked: browser.blocked, site: browser.site ?? t('browser.thisSite') })
          : t('browser.adblockOffTitle', { site: browser.site ?? t('browser.thisSite') })
      "
      :disabled="siteButtonsOff"
      data-testid="browser-adblock"
      :data-blocked="browser.blocked"
      @update:model-value="toggleAdblock"
    >
      <ShieldCheck v-if="browser.adblock" />
      <ShieldOff v-else />
    </Toggle>
    <Toggle
      variant="ghost"
      size="sm"
      :label="t('browser.sharedLabel', { site: browser.site ?? t('browser.thisSite') })"
      :model-value="browser.shared"
      :title="
        browser.shared
          ? t('browser.sharedOnTitle', { site: browser.site ?? t('browser.thisSite') })
          : t('browser.sharedOffTitle', { site: browser.site ?? t('browser.thisSite') })
      "
      :disabled="siteButtonsOff"
      data-testid="browser-shared"
      @update:model-value="toggleShared"
    >
      <Users />
    </Toggle>
    <Button variant="ghost" size="icon-sm" :aria-label="t('browser.newTab')" :title="t('browser.newTab')" :aria-keyshortcuts="keyshortcuts('browser.new-tab')" data-testid="browser-new-tab" @click="newTab">
      <Plus />
    </Button>
    <Button variant="ghost" size="icon-sm" :aria-label="t('browser.external')" :title="t('browser.external')" :disabled="!browser.url" data-testid="browser-external" @click="command('open-external')">
      <ExternalLink />
    </Button>
  </div>
</template>
