<script setup lang="ts">
// Change on the profile banner: a small panel beside it with every banner as a thumbnail, by name. A pick applies at
// once and stays on this PC. Your picture shows only while there is a picture.
import { Check, Pencil } from "@lucide/vue";
import { computed, ref } from "vue";
import { Popover, PopoverContent, PopoverTrigger } from "@tavora/official-ui/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MessageKey } from "../../../shared/i18n";
import { PROFILE_BANNERS, type ProfileBanner as BannerId } from "../../../shared/profile-banner";
import { act } from "../../host";
import { t } from "../../i18n";
import ProfileBanner from "./ProfileBanner.vue";

const props = defineProps<{ banner: BannerId; pictureUrl: string | null }>();
const open = ref(false);
const choices = computed(() => PROFILE_BANNERS.filter((id) => id !== "picture" || props.pictureUrl));

function pick(id: BannerId) {
  void act({ type: "set-profile-banner", banner: id });
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="focus-visible:outline-ring absolute top-2 right-2 flex items-center gap-1.5 rounded-md bg-black/45 px-2 py-1 text-xs font-medium text-white/90 backdrop-blur-sm transition-colors outline-none hover:bg-black/60 focus-visible:outline-2"
        data-testid="profile-banner-change"
      >
        <Pencil class="size-3" :stroke-width="2" aria-hidden="true" />
        {{ t("profile.banner.change") }}
      </button>
    </PopoverTrigger>
    <PopoverContent side="right" align="start" :side-offset="8" class="w-[26rem] p-3" :aria-label="t('profile.banner.title')" data-testid="profile-banners">
      <p class="text-muted-foreground mb-2 px-1 text-xs font-semibold tracking-wider uppercase">{{ t("profile.banner.title") }}</p>
      <div class="grid grid-cols-3 gap-2" role="radiogroup" :aria-label="t('profile.banner.title')">
        <button
          v-for="id in choices"
          :key="id"
          type="button"
          role="radio"
          :aria-checked="id === banner"
          :class="
            cn(
              'group focus-visible:outline-ring flex flex-col gap-1 rounded-lg p-1 text-left outline-none focus-visible:outline-2',
              id === banner ? 'bg-primary/15' : 'hover:bg-accent',
            )
          "
          :data-testid="`profile-banner-${id}`"
          @click="pick(id)"
        >
          <span :class="cn('relative block h-11 overflow-hidden rounded-md border', id === banner && 'border-primary')">
            <ProfileBanner :banner="id" :picture-url="pictureUrl" />
            <Check v-if="id === banner" class="bg-primary text-primary-foreground absolute top-1 right-1 size-4 rounded-full p-0.5" :stroke-width="3" aria-hidden="true" />
          </span>
          <span :class="cn('truncate px-0.5 text-xs', id === banner ? 'text-foreground font-medium' : 'text-muted-foreground')">{{ t(`profile.banner.${id}` as MessageKey) }}</span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
