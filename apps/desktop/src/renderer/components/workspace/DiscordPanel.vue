<script setup lang="ts">
// A Discord panel: the voice channel the player is in, laid out like
// Discord's channel list. Who is there, who is talking (a green ring) and who
// is muted or deafened (red when a moderator did it). Below it, the voice
// channels of the server this game remembers (or of the call's server), with
// who is in them. The player can join a channel, leave, and mute or deafen.
// Everything comes from the Discord app on this PC through the main process.
import { Headphones, HeadphoneOff, Mic, MicOff, Phone, PhoneOff, RefreshCw, Volume2 } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DiscordChannel, DiscordMember } from "../../../shared/host-api";
import { act, discord, openSettings, state } from "../../host";
import { t } from "../../i18n";

const view = computed(() => discord.value);
const gameId = computed(() => (state.value?.screen === "game" ? state.value.currentGameId : null));

/** What the panel says while it is not showing a channel. */
const notice = computed(() => {
  switch (view.value?.status ?? "off") {
    case "no-secret":
      return { title: t("discord.panel.connectTitle"), text: t("discord.panel.connectText"), action: "settings" as const };
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
/** The browsed server gets its own heading when it is not the server of the call. */
const browseHeading = computed(() => (browseServer.value && browseServer.value.id !== server.value?.id ? browseServer.value : null));
const others = computed<DiscordChannel[]>(() => view.value?.others ?? []);
const self = computed(() => view.value?.self ?? null);

const COLOURS = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#7289da"];
/** Discord's default pictures differ by colour; people without a picture get one of these with their initials. */
function colourOf(member: DiscordMember): string {
  return COLOURS[Number(BigInt(member.id) % BigInt(COLOURS.length))]!;
}
function initials(name: string): string {
  return [...name.trim()].slice(0, 2).join("").toUpperCase();
}
const label = (member: DiscordMember) =>
  [
    member.name,
    member.speaking && t("discord.member.talking"),
    (member.selfMute || member.serverMute) && t("discord.member.muted"),
    (member.selfDeaf || member.serverDeaf) && t("discord.member.deafened"),
  ]
    .filter(Boolean)
    .join(", ");

function remember(on: boolean) {
  if (gameId.value) void act({ type: "discord-game-remember", gameId: gameId.value, remember: on });
}
function chooseServer(event: Event) {
  const guildId = (event.target as HTMLSelectElement).value;
  if (gameId.value && guildId) void act({ type: "discord-game-server", gameId: gameId.value, guildId });
}
</script>

<template>
  <div class="bg-background flex size-full flex-col overflow-hidden text-sm" data-testid="discord-panel">
    <div v-if="notice" class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <p class="font-medium">{{ notice.title }}</p>
      <p v-if="notice.text" class="text-muted-foreground max-w-xs">{{ notice.text }}</p>
      <Button v-if="notice.action === 'connect'" class="mt-2" size="sm" data-testid="discord-connect" @click="act({ type: 'discord-connect' })">{{ t("discord.panel.connect") }}</Button>
      <Button v-else-if="notice.action === 'settings'" class="mt-2" size="sm" variant="secondary" @click="openSettings({ section: 'integrations', setting: 'discord-secret' })">
        {{ t("discord.panel.openSettings") }}
      </Button>
    </div>

    <template v-else>
      <header class="flex h-11 flex-none items-center gap-2 border-b px-3 font-semibold shadow-xs">
        <template v-if="headerServer">
          <img v-if="headerServer.icon" :src="headerServer.icon" alt="" class="size-6 rounded-md" draggable="false" />
          <span v-else class="bg-secondary grid size-6 place-items-center rounded-md text-[10px]">{{ initials(headerServer.name) }}</span>
          <span class="min-w-0 truncate" data-testid="discord-server">{{ headerServer.name }}</span>
        </template>
        <template v-else-if="call">
          <Phone class="text-muted-foreground size-4" :stroke-width="1.75" />
          <span class="min-w-0 truncate">{{ t("discord.panel.call") }}</span>
        </template>
        <span v-else class="text-muted-foreground font-medium">Discord</span>
      </header>

      <div v-if="call" class="flex flex-none flex-wrap items-center gap-1 border-b px-2 py-1.5" data-testid="discord-controls">
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
        <Button variant="ghost" size="sm" class="text-destructive ml-auto" data-testid="discord-leave" @click="act({ type: 'discord-leave' })">
          <PhoneOff class="size-4" :stroke-width="1.75" />
          {{ t("discord.panel.leave") }}
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div v-if="!call" class="flex flex-col items-center gap-3 p-3 text-center">
          <p class="text-muted-foreground" data-testid="discord-no-call">{{ t("discord.panel.noCall") }}</p>
          <Button v-if="view?.last" size="sm" class="h-auto flex-col gap-0 py-1.5" data-testid="discord-rejoin" @click="act({ type: 'discord-join', channelId: view.last.channelId })">
            <span>{{ t("discord.panel.rejoin", { name: view.last.name }) }}</span>
            <span v-if="view.last.serverName" class="text-xs font-normal opacity-80">{{ t("discord.panel.rejoinOn", { server: view.last.serverName }) }}</span>
          </Button>
        </div>

        <ul class="min-h-0" data-testid="discord-channels">
          <li v-if="call">
            <div class="bg-secondary text-foreground flex h-8 items-center gap-1.5 rounded-md px-2 font-medium" data-testid="discord-current">
              <Volume2 class="size-4 flex-none" :stroke-width="1.75" />
              <span class="min-w-0 truncate">{{ call.name }}</span>
            </div>
            <ul class="mt-0.5">
              <li
                v-for="member in call.members"
                :key="member.id"
                class="flex h-8 items-center gap-2 rounded-md pr-2 pl-8"
                :aria-label="label(member)"
                :data-testid="`discord-member-${member.id}`"
                :data-speaking="member.speaking || undefined"
              >
                <span
                  :class="
                    cn(
                      'relative grid size-6 flex-none place-items-center rounded-full text-[9px] font-semibold text-white',
                      member.speaking && 'ring-success ring-offset-background ring-2 ring-offset-2',
                    )
                  "
                  :style="member.avatar ? undefined : { background: colourOf(member) }"
                >
                  <img v-if="member.avatar" :src="member.avatar" alt="" class="size-6 rounded-full" draggable="false" />
                  <template v-else>{{ initials(member.name) }}</template>
                </span>
                <span class="text-foreground min-w-0 flex-1 truncate">{{ member.name }}</span>
                <MicOff
                  v-if="member.selfMute || member.serverMute"
                  :class="cn('size-4 flex-none', member.serverMute ? 'text-destructive' : 'text-muted-foreground')"
                  :stroke-width="1.75"
                  :aria-label="member.serverMute ? t('discord.member.mutedByMod') : t('discord.member.muted')"
                />
                <HeadphoneOff
                  v-if="member.selfDeaf || member.serverDeaf"
                  :class="cn('size-4 flex-none', member.serverDeaf ? 'text-destructive' : 'text-muted-foreground')"
                  :stroke-width="1.75"
                  :aria-label="member.serverDeaf ? t('discord.member.deafenedByMod') : t('discord.member.deafened')"
                />
              </li>
            </ul>
          </li>

          <li v-if="browseHeading && others.length" class="text-muted-foreground mt-3 flex items-center gap-1.5 px-2 text-xs font-semibold" data-testid="discord-browse-server">
            <img v-if="browseHeading.icon" :src="browseHeading.icon" alt="" class="size-4 rounded-sm" draggable="false" />
            <span class="min-w-0 truncate">{{ browseHeading.name }}</span>
          </li>
          <li v-for="channel in others" :key="channel.id" class="mt-1">
            <button
              type="button"
              class="text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left"
              :title="t('discord.panel.join', { name: channel.name })"
              :data-testid="`discord-join-${channel.id}`"
              @click="act({ type: 'discord-join', channelId: channel.id })"
            >
              <Volume2 class="size-4 flex-none" :stroke-width="1.75" />
              <span class="min-w-0 truncate">{{ channel.name }}</span>
            </button>
            <ul class="mt-0.5">
              <li
                v-for="member in channel.members"
                :key="member.id"
                class="flex h-8 items-center gap-2 rounded-md pr-2 pl-8"
                :aria-label="label(member)"
                :data-testid="`discord-member-${member.id}`"
                :data-speaking="member.speaking || undefined"
              >
                <span
                  class="relative grid size-6 flex-none place-items-center rounded-full text-[9px] font-semibold text-white"
                  :style="member.avatar ? undefined : { background: colourOf(member) }"
                >
                  <img v-if="member.avatar" :src="member.avatar" alt="" class="size-6 rounded-full" draggable="false" />
                  <template v-else>{{ initials(member.name) }}</template>
                </span>
                <span class="text-muted-foreground min-w-0 flex-1 truncate">{{ member.name }}</span>
                <MicOff v-if="member.selfMute || member.serverMute" class="text-muted-foreground size-4 flex-none" :stroke-width="1.75" :aria-label="t('discord.member.muted')" />
                <HeadphoneOff v-if="member.selfDeaf || member.serverDeaf" class="text-muted-foreground size-4 flex-none" :stroke-width="1.75" :aria-label="t('discord.member.deafened')" />
              </li>
            </ul>
          </li>
        </ul>
      </div>

      <footer v-if="gameId" class="flex flex-none flex-col gap-1.5 border-t px-3 py-2" data-testid="discord-game">
        <label class="flex cursor-pointer items-center gap-2">
          <input type="checkbox" class="accent-primary size-4" :checked="view?.game.remember ?? false" data-testid="discord-remember" @change="remember(($event.target as HTMLInputElement).checked)" />
          <span class="min-w-0 flex-1">{{ t("discord.game.remember") }}</span>
          <Button variant="ghost" size="icon-xs" :title="t('discord.game.refresh')" :aria-label="t('discord.game.refresh')" data-testid="discord-refresh" @click.prevent="act({ type: 'discord-refresh' })">
            <RefreshCw :stroke-width="1.75" />
          </Button>
        </label>
        <select
          v-if="view?.game.remember"
          class="border-input bg-background h-8 w-full rounded-md border px-2"
          :value="view.game.serverId ?? ''"
          :aria-label="t('discord.game.server')"
          data-testid="discord-server-select"
          @change="chooseServer"
        >
          <option value="" disabled>{{ t("discord.game.choose") }}</option>
          <option v-for="option in view.servers" :key="option.id" :value="option.id">{{ option.name }}</option>
        </select>
      </footer>
    </template>
  </div>
</template>
