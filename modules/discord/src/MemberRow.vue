<script setup lang="ts">
// One person in a voice channel: picture (with a green ring while talking), name and mute icons.
// For the people in the player's own call (not the player) a right-click, or the "…" button, opens
// a menu with that person's volume and "Mute for me". Both are Discord's own per-person settings,
// so they work the same in Discord's menu and stay there.
import { Ellipsis, HeadphoneOff, MicOff, Volume1, VolumeX } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { computed, ref } from "vue";
import { t } from "./i18n";
import type { Member } from "./panel";
import { colourOf, initials } from "./ui";

const props = defineProps<{
  member: Member;
  /** The channel the player is in (not one that is only listed). */
  current: boolean;
  /** This person can be adjusted: in the player's call, and not the player. */
  menu: boolean;
}>();

const emit = defineEmits<{ voice: [settings: { volume?: number; mute?: boolean }] }>();

const open = ref(false);

const label = computed(() =>
  [
    props.member.name,
    props.member.speaking && t("member.talking"),
    (props.member.selfMute || props.member.serverMute) && t("member.muted"),
    (props.member.selfDeaf || props.member.serverDeaf) && t("member.deafened"),
    props.member.mutedForMe && t("member.mutedForYou"),
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
  emit("voice", { volume: value });
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
  emit("voice", { mute: !props.member.mutedForMe });
}

/** A right-click on the row opens the same menu as the "…" button. */
function onContextMenu(event: MouseEvent) {
  if (!props.menu) return;
  event.preventDefault();
  open.value = true;
}
</script>

<template>
  <li
    class="group flex h-8 items-center gap-2 rounded-md pr-2 pl-8"
    :aria-label="label"
    :data-testid="`discord-member-${member.id}`"
    :data-speaking="member.speaking || undefined"
    @contextmenu="onContextMenu"
  >
    <span
      :class="cn('relative grid size-6 flex-none place-items-center rounded-full text-[9px] font-semibold text-white', member.speaking && 'ring-success ring-offset-background ring-2 ring-offset-2')"
      :style="member.avatar ? undefined : { background: colourOf(member.id) }"
    >
      <img v-if="member.avatar" :src="member.avatar" alt="" class="size-6 rounded-full" draggable="false" />
      <template v-else>{{ initials(member.name) }}</template>
    </span>
    <span :class="cn('min-w-0 flex-1 truncate', current || member.speaking ? 'text-foreground' : 'text-muted-foreground')">{{ member.name }}</span>
    <VolumeX v-if="member.mutedForMe" class="text-muted-foreground size-4 flex-none" :stroke-width="1.75" :aria-label="t('member.mutedForYou')" data-testid="discord-muted-for-me" />
    <Volume1 v-else-if="member.volume !== 100" class="text-muted-foreground size-4 flex-none" :stroke-width="1.75" :aria-label="t('member.volume', { percent: member.volume })" />
    <MicOff
      v-if="member.selfMute || member.serverMute"
      :class="cn('size-4 flex-none', member.serverMute ? 'text-destructive' : 'text-muted-foreground')"
      :stroke-width="1.75"
      :aria-label="member.serverMute ? t('member.mutedByMod') : t('member.muted')"
    />
    <HeadphoneOff
      v-if="member.selfDeaf || member.serverDeaf"
      :class="cn('size-4 flex-none', member.serverDeaf ? 'text-destructive' : 'text-muted-foreground')"
      :stroke-width="1.75"
      :aria-label="member.serverDeaf ? t('member.deafenedByMod') : t('member.deafened')"
    />
    <DropdownMenu v-if="menu" v-model:open="open">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="icon-xs"
          class="flex-none opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          :title="t('menu.open', { name: member.name })"
          :aria-label="t('menu.open', { name: member.name })"
          :data-testid="`discord-menu-${member.id}`"
        >
          <Ellipsis :stroke-width="1.75" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-64" data-testid="discord-user-menu">
        <DropdownMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ member.name }}</DropdownMenuLabel>
        <div class="px-2 pt-1 pb-2">
          <div class="flex items-center justify-between text-sm">
            <label :for="`discord-volume-${member.id}`">{{ t("menu.volume") }}</label>
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
            @keydown.stop
          />
        </div>
        <DropdownMenuItem :disabled="volume === 100" data-testid="discord-user-reset" @select="reset">{{ t("menu.reset") }}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="discord-user-mute" @select="toggleMute">{{ member.mutedForMe ? t("menu.unmute") : t("menu.mute") }}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </li>
</template>
