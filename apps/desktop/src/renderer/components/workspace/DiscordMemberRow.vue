<script setup lang="ts">
// One person in a voice channel: picture (with a green ring while talking),
// name and mute icons. For the people in the player's own call (not the
// player) a right-click, or the "…" button, opens a menu with that person's
// volume and "Mute for me". Both are Discord's own per-person settings, so
// they work the same in Discord's menu and stay there.
import { Ellipsis, HeadphoneOff, MicOff, Volume1, VolumeX } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { DiscordMember } from "../../../shared/host-api";
import { act, useFloating } from "../../host";
import { t } from "../../i18n";
import { colourOf, initials } from "./discord-ui";

const props = defineProps<{
  member: DiscordMember;
  /** The channel the player is in (not one that is only listed). */
  current: boolean;
  /** This person can be adjusted: in the player's call, and not the player. */
  menu: boolean;
}>();

const track = useFloating();
const row = ref<HTMLElement | null>(null);

const label = computed(() =>
  [
    props.member.name,
    props.member.speaking && t("discord.member.talking"),
    (props.member.selfMute || props.member.serverMute) && t("discord.member.muted"),
    (props.member.selfDeaf || props.member.serverDeaf) && t("discord.member.deafened"),
    props.member.mutedForMe && t("discord.member.mutedForYou"),
  ]
    .filter(Boolean)
    .join(", "),
);

// The volume shows what the player drags while dragging, and what Discord reports otherwise.
const dragging = ref<number | null>(null);
const volume = computed(() => dragging.value ?? props.member.volume);
let latest = props.member.volume;
let sent = props.member.volume;
let timer: ReturnType<typeof setTimeout> | undefined;

function send(value: number) {
  sent = value;
  void act({ type: "discord-user-voice", userId: props.member.id, volume: value });
}
/** Sends the value at once, then at most every 100 ms while the slider keeps moving. */
function onInput(event: Event) {
  latest = Number((event.target as HTMLInputElement).value);
  dragging.value = latest;
  if (timer) return;
  send(latest);
  timer = setTimeout(() => {
    timer = undefined;
    if (latest !== sent) send(latest);
  }, 100);
}
function onChange() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (latest !== sent) send(latest);
  dragging.value = null;
}
function reset() {
  latest = 100;
  dragging.value = null;
  send(100);
}
function toggleMute() {
  void act({ type: "discord-user-voice", userId: props.member.id, mute: !props.member.mutedForMe });
}

/** The "…" button asks the row's own context menu to open next to it. */
function openMenu(event: MouseEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  row.value?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom }));
}
</script>

<template>
  <ContextMenu @update:open="track">
    <ContextMenuTrigger as-child :disabled="!menu">
      <li
        ref="row"
        class="group flex h-8 items-center gap-2 rounded-md pr-2 pl-8"
        :aria-label="label"
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
        <span :class="cn('min-w-0 flex-1 truncate', current || member.speaking ? 'text-foreground' : 'text-muted-foreground')">{{ member.name }}</span>
        <VolumeX v-if="member.mutedForMe" class="text-muted-foreground size-4 flex-none" :stroke-width="1.75" :title="t('discord.member.mutedForYou')" :aria-label="t('discord.member.mutedForYou')" data-testid="discord-muted-for-me" />
        <Volume1
          v-else-if="member.volume !== 100"
          class="text-muted-foreground size-4 flex-none"
          :stroke-width="1.75"
          :title="t('discord.member.volume', { percent: member.volume })"
          :aria-label="t('discord.member.volume', { percent: member.volume })"
        />
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
        <Button
          v-if="menu"
          variant="ghost"
          size="icon-xs"
          class="flex-none opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          :title="t('discord.menu.open', { name: member.name })"
          :aria-label="t('discord.menu.open', { name: member.name })"
          :data-testid="`discord-menu-${member.id}`"
          @click.stop="openMenu"
        >
          <Ellipsis :stroke-width="1.75" />
        </Button>
      </li>
    </ContextMenuTrigger>
    <ContextMenuContent v-if="menu" class="w-64" data-testid="discord-user-menu">
      <ContextMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ member.name }}</ContextMenuLabel>
      <div class="px-2 pt-1 pb-2">
        <div class="flex items-center justify-between text-sm">
          <label :for="`discord-volume-${member.id}`">{{ t("discord.menu.volume") }}</label>
          <span class="text-muted-foreground tabular-nums" data-testid="discord-user-volume-value">{{ volume }}%</span>
        </div>
        <input
          :id="`discord-volume-${member.id}`"
          type="range"
          min="0"
          max="200"
          step="5"
          class="accent-primary mt-2 w-full"
          :value="volume"
          data-testid="discord-user-volume"
          @input="onInput"
          @change="onChange"
        />
      </div>
      <ContextMenuItem :disabled="volume === 100" data-testid="discord-user-reset" @select="reset">{{ t("discord.menu.reset") }}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem data-testid="discord-user-mute" @select="toggleMute">{{ member.mutedForMe ? t("discord.menu.unmute") : t("discord.menu.mute") }}</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
