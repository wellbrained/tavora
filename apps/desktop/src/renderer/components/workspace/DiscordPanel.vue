<script setup lang="ts">
// A Discord panel: the voice channel the player is in, laid out like
// Discord's channel list. Who is there, who is talking (a green ring) and who
// is muted or deafened (red when a moderator did it). The server's other
// voice channels follow. Everything comes from the Discord app on this PC
// through the main process; the player talks in Discord as usual.
import { HeadphoneOff, MicOff, Phone, Volume2 } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DiscordChannel, DiscordMember } from "../../../shared/host-api";
import { act, discord, openSettings } from "../../host";
import { t } from "../../i18n";

const view = computed(() => discord.value);

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
const call = computed(() => view.value?.call ?? null);
const channels = computed<{ channel: DiscordChannel; current: boolean }[]>(() => {
  if (!call.value) return [];
  // The player's own channel comes first, then the server's others in Discord's order.
  return [{ channel: call.value, current: true }, ...(view.value?.others ?? []).map((channel) => ({ channel, current: false }))];
});

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
</script>

<template>
  <div class="bg-background flex size-full flex-col overflow-hidden text-sm" data-testid="discord-panel">
    <div v-if="notice" class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <p class="font-medium">{{ notice.title }}</p>
      <p v-if="notice.text" class="text-muted-foreground max-w-xs">{{ notice.text }}</p>
      <Button v-if="notice.action === 'connect'" class="mt-2" size="sm" data-testid="discord-connect" @click="act({ type: 'discord-connect' })">{{ t("discord.panel.connect") }}</Button>
      <Button v-else-if="notice.action === 'settings'" class="mt-2" size="sm" variant="secondary" @click="openSettings({ section: 'discord', setting: 'discord-secret' })">
        {{ t("discord.panel.openSettings") }}
      </Button>
    </div>

    <template v-else>
      <header class="flex h-11 flex-none items-center gap-2 border-b px-3 font-semibold shadow-xs">
        <template v-if="server">
          <img v-if="server.icon" :src="server.icon" alt="" class="size-6 rounded-md" draggable="false" />
          <span v-else class="bg-secondary grid size-6 place-items-center rounded-md text-[10px]">{{ initials(server.name) }}</span>
          <span class="min-w-0 truncate" data-testid="discord-server">{{ server.name }}</span>
        </template>
        <template v-else-if="call">
          <Phone class="text-muted-foreground size-4" :stroke-width="1.75" />
          <span class="min-w-0 truncate">{{ t("discord.panel.call") }}</span>
        </template>
        <span v-else class="text-muted-foreground font-medium">Discord</span>
      </header>

      <p v-if="!call" class="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center" data-testid="discord-no-call">
        {{ t("discord.panel.noCall") }}
      </p>

      <ul v-else class="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="discord-channels">
        <li v-for="{ channel, current } in channels" :key="channel.id" :class="cn(!current && 'mt-1')">
          <div
            :class="
              cn(
                'flex h-8 items-center gap-1.5 rounded-md px-2',
                current ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground',
              )
            "
            :data-testid="current ? 'discord-current' : undefined"
          >
            <Volume2 class="size-4 flex-none" :stroke-width="1.75" />
            <span class="min-w-0 truncate">{{ channel.name }}</span>
          </div>
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
              <span :class="cn('min-w-0 flex-1 truncate', member.speaking || current ? 'text-foreground' : 'text-muted-foreground')">{{ member.name }}</span>
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
      </ul>
    </template>
  </div>
</template>
