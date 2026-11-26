<script setup lang="ts">
// Change on the profile banner: a small panel beside it with every banner as a thumbnail, by name. A pick applies at
// once and stays on this PC. Your picture shows only while there is a picture.
import { Pencil } from "@lucide/vue";
import { computed, ref } from "vue";
import { Popover, PopoverContent, PopoverTrigger } from "@tavora/official-ui/components/ui/popover";
import { Button } from "@tavora/official-ui/components/ui/button";
import { StyleTiles } from "@tavora/official-ui/components/ui/style-tiles";
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
      <Button variant="ghost" size="xs" class="absolute top-2 right-2 bg-black/45 text-white/90 backdrop-blur-sm hover:bg-black/60 hover:text-white/90" data-testid="profile-banner-change">
        <Pencil class="size-3" aria-hidden="true" />
        {{ t("profile.banner.change") }}
      </Button>
    </PopoverTrigger>
    <PopoverContent side="right" align="start" :side-offset="8" class="w-[26rem] p-3" :aria-label="t('profile.banner.title')" data-testid="profile-banners">
      <p class="text-muted-foreground mb-2 px-1 text-xs font-semibold tracking-wider uppercase">{{ t("profile.banner.title") }}</p>
      <StyleTiles
        :model-value="banner"
        :options="choices.map((id) => ({ value: id, label: t(`profile.banner.${id}` as MessageKey), testid: `profile-banner-${id}` }))"
        :label="t('profile.banner.title')"
        class="grid-cols-3"
        @update:model-value="pick"
      >
        <template #tile="{ option }"><ProfileBanner :banner="option.value" :picture-url="pictureUrl" /></template>
      </StyleTiles>
    </PopoverContent>
  </Popover>
</template>
