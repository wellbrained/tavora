<script setup lang="ts">
// A Discord panel: the voice channel the player is in, laid out like
// Discord's channel list. Who is there, who is talking (a green ring) and who
// is muted or deafened (red when a moderator did it). Below it, the voice
// channels of the server this game remembers (or of the call's server), with
// who is in them. The player can join a channel, leave, and mute or deafen.
// Everything comes from the Discord app on this PC through the main process.
import { Check, ChevronDown, Headphones, HeadphoneOff, Info, Mic, MicOff, Phone, PhoneOff, RefreshCw, Search, Volume2 } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DiscordChannel } from "../../../shared/host-api";
import { act, discord, state } from "../../host";
import { t } from "../../i18n";
import DiscordMemberRow from "./DiscordMemberRow.vue";
import { initials } from "./discord-ui";

const view = computed(() => discord.value);
const gameId = computed(() => (state.value?.screen === "game" ? state.value.currentGameId : null));

/** What the panel says while it is not showing a channel. */
const notice = computed(() => {
  switch (view.value?.status ?? "off") {
    case "signed-out":
      return { title: t("discord.panel.signedOutTitle"), text: t("discord.panel.signedOutText"), action: "connect" as const };
    case "approving":
      return { title: t("discord.panel.approveTitle"), text: t("discord.panel.approveText"), action: null };
    case "not-running":
      return { title: t("discord.panel.notRunningTitle"), text: t("discord.panel.notRunningText"), action: null };
    case "error":
      return { title: t("discord.panel.errorTitle"), text: t(view.value?.error ?? "discord.error.generic"), action: "connect" as const };
    case "connected":
      return null;
    default:
      return { title: t("discord.panel.connectingTitle"), text: "", action: null };
  }
});

const server = computed(() => view.value?.server ?? null);
const browseServer = computed(() => view.value?.browseServer ?? null);
const call = computed(() => view.value?.call ?? null);
const headerServer = computed(() => server.value ?? (call.value ? null : browseServer.value));
/** While in a call, the browsed server gets its own heading when it is not the call's server; with no call the header already names it. */
const browseHeading = computed(() => (call.value && browseServer.value && browseServer.value.id !== server.value?.id ? browseServer.value : null));
const channels = computed<DiscordChannel[]>(() => view.value?.channels ?? []);

type Entry =
  | { kind: "heading"; key: string; server: { id: string; name: string; icon: string | null } }
  | { kind: "channel"; key: string; channel: DiscordChannel; current: boolean };
/**
 * The server's channels in the server's own order, with the channel the
 * player is in marked and shown live where it belongs, never moved to the top.
 * A call that is not in this list (another server, a direct call) comes first.
 */
const entries = computed<Entry[]>(() => {
  const live = call.value;
  const result: Entry[] = [];
  if (live && !channels.value.some((channel) => channel.id === live.id)) result.push({ kind: "channel", key: live.id, channel: live, current: true });
  if (browseHeading.value && channels.value.length) result.push({ kind: "heading", key: "heading", server: browseHeading.value });
  for (const channel of channels.value) {
    const current = channel.id === live?.id;
    result.push({ kind: "channel", key: channel.id, channel: current ? live! : channel, current });
  }
  return result;
});
const self = computed(() => view.value?.self ?? null);

function remember(on: boolean) {
  if (gameId.value) void act({ type: "discord-game-remember", gameId: gameId.value, remember: on });
}
// The server picker: a button that opens a searchable list of the servers the player is on.
const pickerOpen = ref(false);
const query = ref("");
const picker = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const servers = computed(() => view.value?.servers ?? []);
const selectedId = computed(() => view.value?.game.serverId ?? null);
const selectedName = computed(() => servers.value.find((option) => option.id === selectedId.value)?.name ?? (browseServer.value?.id === selectedId.value ? browseServer.value?.name : null) ?? null);
const matches = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return needle ? servers.value.filter((option) => option.name.toLowerCase().includes(needle)) : servers.value;
});
async function togglePicker() {
  pickerOpen.value = !pickerOpen.value;
  query.value = "";
  if (pickerOpen.value) {
    await nextTick();
    search.value?.focus();
  }
}
function pick(guildId: string) {
  pickerOpen.value = false;
  if (gameId.value) void act({ type: "discord-game-server", gameId: gameId.value, guildId });
}
const closeOutside = (event: PointerEvent) => {
  if (pickerOpen.value && !picker.value?.contains(event.target as Node)) pickerOpen.value = false;
};
onMounted(() => document.addEventListener("pointerdown", closeOutside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", closeOutside));
</script>

<template>
  <div class="bg-background flex size-full flex-col overflow-hidden text-sm" data-testid="discord-panel">
    <div v-if="notice" class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <p class="font-medium">{{ notice.title }}</p>
      <p v-if="notice.text" class="text-muted-foreground max-w-xs">{{ notice.text }}</p>
      <Button v-if="notice.action === 'connect'" class="mt-2" size="sm" data-testid="discord-connect" @click="act({ type: 'discord-connect' })">{{ t("discord.panel.connect") }}</Button>
    </div>

    <template v-else>
      <header class="flex h-11 flex-none items-center gap-2 border-b pr-1.5 pl-3 shadow-xs" data-testid="discord-header">
        <div class="flex min-w-0 flex-1 items-center gap-2 font-semibold">
          <template v-if="headerServer">
            <img v-if="headerServer.icon" :src="headerServer.icon" alt="" class="size-6 flex-none rounded-md" draggable="false" />
            <span v-else class="bg-secondary grid size-6 flex-none place-items-center rounded-md text-[10px]">{{ initials(headerServer.name) }}</span>
            <span class="min-w-0 truncate" data-testid="discord-server">{{ headerServer.name }}</span>
          </template>
          <template v-else-if="call">
            <Phone class="text-muted-foreground size-4 flex-none" :stroke-width="1.75" />
            <span class="min-w-0 truncate">{{ t("discord.panel.call") }}</span>
          </template>
          <span v-else class="text-muted-foreground font-medium">Discord</span>
        </div>

        <div v-if="call" class="flex flex-none items-center" data-testid="discord-controls">
          <template v-if="view?.canControl">
            <Button
              variant="ghost"
              size="icon-sm"
              :class="cn(self?.mute && 'text-destructive')"
              :title="self?.mute ? t('discord.panel.unmute') : t('discord.panel.mute')"
              :aria-label="self?.mute ? t('discord.panel.unmute') : t('discord.panel.mute')"
              :aria-pressed="self?.mute ?? false"
              data-testid="discord-mute"
              @click="act({ type: 'discord-voice', mute: !self?.mute })"
            >
              <MicOff v-if="self?.mute" class="size-4" :stroke-width="1.75" />
              <Mic v-else class="size-4" :stroke-width="1.75" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :class="cn(self?.deaf && 'text-destructive')"
              :title="self?.deaf ? t('discord.panel.undeafen') : t('discord.panel.deafen')"
              :aria-label="self?.deaf ? t('discord.panel.undeafen') : t('discord.panel.deafen')"
              :aria-pressed="self?.deaf ?? false"
              data-testid="discord-deafen"
              @click="act({ type: 'discord-voice', deaf: !self?.deaf })"
            >
              <HeadphoneOff v-if="self?.deaf" class="size-4" :stroke-width="1.75" />
              <Headphones v-else class="size-4" :stroke-width="1.75" />
            </Button>
          </template>
          <Button v-else variant="ghost" size="sm" :title="t('discord.panel.allowControlHint')" data-testid="discord-allow-control" @click="act({ type: 'discord-allow-control' })">
            {{ t("discord.panel.allowControl") }}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-destructive"
            :title="t('discord.panel.leave')"
            :aria-label="t('discord.panel.leave')"
            data-testid="discord-leave"
            @click="act({ type: 'discord-leave' })"
          >
            <PhoneOff class="size-4" :stroke-width="1.75" />
          </Button>
        </div>
        <Button
          v-else-if="view?.last"
          variant="ghost"
          size="sm"
          class="max-w-[55%] min-w-0 flex-none"
          :title="t('discord.panel.rejoin', { name: view.last.name })"
          data-testid="discord-rejoin"
          @click="act({ type: 'discord-join', channelId: view.last.channelId })"
        >
          <Phone class="size-4" :stroke-width="1.75" />
          <span class="min-w-0 truncate">{{ t("discord.panel.rejoin", { name: view.last.name }) }}</span>
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ul class="min-h-0" data-testid="discord-channels">
          <template v-for="entry in entries" :key="entry.key">
            <li v-if="entry.kind === 'heading'" class="text-muted-foreground mt-3 flex items-center gap-1.5 px-2 text-xs font-semibold" data-testid="discord-browse-server">
              <img v-if="entry.server.icon" :src="entry.server.icon" alt="" class="size-4 rounded-sm" draggable="false" />
              <span class="min-w-0 truncate">{{ entry.server.name }}</span>
            </li>
            <li v-else class="mt-1 first:mt-0">
              <div v-if="entry.current" class="bg-secondary text-foreground flex h-8 items-center gap-1.5 rounded-md px-2 font-medium" data-testid="discord-current">
                <Volume2 class="size-4 flex-none" :stroke-width="1.75" />
                <span class="min-w-0 truncate">{{ entry.channel.name }}</span>
              </div>
              <button
                v-else
                type="button"
                class="text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left"
                :title="t('discord.panel.join', { name: entry.channel.name })"
                :data-testid="`discord-join-${entry.channel.id}`"
                @click="act({ type: 'discord-join', channelId: entry.channel.id })"
              >
                <Volume2 class="size-4 flex-none" :stroke-width="1.75" />
                <span class="min-w-0 truncate">{{ entry.channel.name }}</span>
              </button>
              <ul class="mt-0.5">
                <DiscordMemberRow
                  v-for="member in entry.channel.members"
                  :key="member.id"
                  :member="member"
                  :current="entry.current"
                  :menu="entry.current && member.id !== view?.user?.id"
                />
              </ul>
            </li>
          </template>
        </ul>
      </div>

      <div v-if="!call" class="flex-none px-2 pb-2">
        <div role="status" class="bg-info/10 flex items-start gap-2 rounded-md p-3 text-sm" data-testid="discord-no-call">
          <Info class="text-info mt-0.5 size-4 flex-none" :stroke-width="1.5" />
          <span>{{ t(channels.length ? "discord.panel.noCall" : "discord.panel.noCallEmpty") }}</span>
        </div>
      </div>

      <footer v-if="gameId" class="flex flex-none flex-col gap-1.5 border-t px-3 py-2" data-testid="discord-game">
        <label class="flex cursor-pointer items-center gap-2">
          <input type="checkbox" class="accent-primary size-4" :checked="view?.game.remember ?? false" data-testid="discord-remember" @change="remember(($event.target as HTMLInputElement).checked)" />
          <span class="min-w-0 flex-1">{{ t("discord.game.remember") }}</span>
          <Button variant="ghost" size="icon-xs" :title="t('discord.game.refresh')" :aria-label="t('discord.game.refresh')" data-testid="discord-refresh" @click.prevent="act({ type: 'discord-refresh' })">
            <RefreshCw :stroke-width="1.75" />
          </Button>
        </label>
        <div v-if="view?.game.remember" ref="picker" class="relative">
          <button
            type="button"
            class="border-input hover:bg-secondary/60 focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border px-2 text-left outline-none focus-visible:ring-3"
            :aria-expanded="pickerOpen"
            :aria-label="t('discord.game.server')"
            data-testid="discord-server-select"
            @click="togglePicker"
          >
            <span :class="cn('min-w-0 flex-1 truncate', !selectedName && 'text-muted-foreground')">{{ selectedName ?? t("discord.game.choose") }}</span>
            <ChevronDown :class="cn('text-muted-foreground size-4 flex-none transition-transform', pickerOpen && 'rotate-180')" :stroke-width="1.75" />
          </button>
          <div
            v-if="pickerOpen"
            class="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 z-10 mb-1 flex max-h-[min(16rem,60vh)] flex-col overflow-hidden rounded-md border shadow-md"
            data-testid="discord-server-list"
            @keydown.esc.stop="pickerOpen = false"
          >
            <div class="flex flex-none items-center gap-2 border-b px-2">
              <Search class="text-muted-foreground size-4 flex-none" :stroke-width="1.75" />
              <input
                ref="search"
                v-model="query"
                type="text"
                autocomplete="off"
                spellcheck="false"
                class="placeholder:text-muted-foreground h-9 min-w-0 flex-1 bg-transparent outline-none"
                :placeholder="t('discord.game.search')"
                :aria-label="t('discord.game.search')"
                data-testid="discord-server-search"
              />
            </div>
            <ul class="min-h-0 flex-1 overflow-y-auto p-1">
              <li v-for="option in matches" :key="option.id">
                <button
                  type="button"
                  :class="cn('hover:bg-secondary flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left', option.id === selectedId && 'bg-secondary/60')"
                  :data-testid="`discord-server-${option.id}`"
                  @click="pick(option.id)"
                >
                  <span class="min-w-0 flex-1 truncate">{{ option.name }}</span>
                  <Check v-if="option.id === selectedId" class="text-primary size-4 flex-none" :stroke-width="1.75" />
                </button>
              </li>
              <li v-if="!matches.length" class="text-muted-foreground px-2 py-3 text-center text-xs">{{ t("discord.game.noMatch") }}</li>
            </ul>
          </div>
        </div>
      </footer>
    </template>
  </div>
</template>
