<script setup lang="ts">
// The user's avatar in the rail footer, with their name and what they are up to when the rail is wide. A click opens
// the profile dialog (ProfileDialog.vue): the picture, name, initials and ranks, and the account behind them.
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { account, openProfile, profileOpen, state } from "../../host";
import { t } from "../../i18n";
import ProfileAvatar from "./ProfileAvatar.vue";
import RailFooterTile from "../RailFooterTile.vue";
import RailTooltip from "../RailTooltip.vue";

defineProps<{ expanded: boolean }>();

const profile = computed(() => state.value!.profile);
/**
 * The second line: the game running now, else whether the user is signed in. That is the game the rail offers to
 * switch to, else the open workspace's own game while it runs (runningGameId leaves that one out).
 */
const runningGame = computed(() => {
  const view = state.value!;
  const id = view.runningGameId ?? (view.workspaceRunning ? view.currentWorkspaceId : null);
  return id ? (view.library.workspaces[id] ?? null) : null;
});
const status = computed(() =>
  runningGame.value ? t("rail.playing", { name: runningGame.value.name }) : account.value?.account ? t("rail.signedIn") : t("rail.signedOut"),
);
</script>

<template>
  <RailTooltip :text="profile.name.trim() || t('profile.label')" :disabled="expanded || profileOpen">
    <button
      type="button"
      :class="
        cn(
          // In front of the card of a running game, which peeks out from behind it (RunningGameButton.vue).
          'group text-muted-foreground hover:text-foreground relative z-10 mx-2 flex items-center gap-2.5 rounded-lg p-1 transition-colors focus-visible:-outline-offset-2 data-[state=open]:text-foreground',
          // Wide, the profile is a card of its own at the very bottom, on a glow in the theme's colour (styles.css).
          // Rounded like the other rail items; the avatar's corners follow: 8 px - 4 px padding - 1 px border = 3 px.
          expanded && 'profile-rail-card text-foreground relative overflow-hidden rounded-lg border p-1 text-left',
        )
      "
      data-rail-item
      data-testid="rail-profile"
      aria-haspopup="dialog"
      :data-state="profileOpen ? 'open' : 'closed'"
      :aria-label="profile.name.trim() ? t('profile.named', { name: profile.name.trim() }) : t('profile.label')"
      @click="openProfile()"
    >
      <template v-if="expanded">
        <!-- A thin light edge and a soft shadow keep any picture apart from the glow behind it. -->
        <span class="ring-foreground/25 relative flex-none rounded-[3px] shadow-md ring-1 shadow-black/30">
          <ProfileAvatar class="bg-card" :name="profile.name" :initials="profile.initials" :picture-url="profile.pictureUrl" :size="38" square :radius="3" />
        </span>
        <span class="relative flex min-w-0 flex-col">
          <span class="truncate text-sm font-semibold">{{ profile.name.trim() || t("profile.label") }}</span>
          <span :class="cn('truncate text-xs font-medium', runningGame ? 'text-success' : 'text-foreground/80')" data-testid="rail-profile-status">{{ status }}</span>
        </span>
      </template>
      <RailFooterTile v-else>
        <ProfileAvatar :name="profile.name" :initials="profile.initials" :picture-url="profile.pictureUrl" :size="40" square />
      </RailFooterTile>
    </button>
  </RailTooltip>
</template>
