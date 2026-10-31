<script setup lang="ts">
// The profile dialog, opened from the avatar in the rail (ProfileMenu.vue) or wherever the account is needed
// (openProfile). On the left: the picture over a banner the user picks (BannerPicker.vue), the name beside it, and a
// short menu on a plate like Settings': Name & ranks, Account (signing in and everything about the account), Cloud copy
// and Messages. The menu shows only what this run has: Account once accounts are on, Cloud copy and Messages once they
// are there. On the right: the chosen part, under Profile / its name, like a Settings page.
import { Camera, Cloud, Mail, UserRound, UserRoundPen, X } from "@lucide/vue";
import { computed, provide, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { cn } from "@/lib/utils";
import { account, act, cloudCopy, inbox, profileOpen, profileTarget, state, type ProfileSection } from "../../host";
import { t } from "../../i18n";
import ImageCropDialog from "../ImageCropDialog.vue";
import AccountSection from "../settings/AccountSection.vue";
import CloudCopySettings from "../settings/CloudCopySettings.vue";
import MessagesSettings from "../settings/MessagesSettings.vue";
import { SETTINGS_PAGE_TITLE } from "../settings/settings-page";
import { autoInitials } from "./initials";
import { readPicture } from "./picture";
import BannerPicker from "./BannerPicker.vue";
import ProfileAvatar from "./ProfileAvatar.vue";
import ProfileBanner from "./ProfileBanner.vue";
import ProfileEditor from "./ProfileEditor.vue";

const profile = computed(() => state.value!.profile);

/** The parts this run has, in menu order. */
const sections = computed(() =>
  [
    { id: "profile" as const, label: t("profile.section.profile"), icon: UserRoundPen, shown: true },
    { id: "account" as const, label: t("profile.section.account"), icon: UserRound, shown: account.value?.enabled === true },
    { id: "cloud-copy" as const, label: t("profile.section.cloud-copy"), icon: Cloud, shown: cloudCopy.value != null },
    { id: "messages" as const, label: t("profile.section.messages"), icon: Mail, shown: inbox.value.active },
  ].filter((item) => item.shown),
);
const section = ref<ProfileSection>("profile");
/** A part that is not there on this run (accounts off) falls back to Profile. */
const shown = computed<ProfileSection>(() => (sections.value.some((item) => item.id === section.value) ? section.value : "profile"));
const navGroups = computed<NavGroup[]>(() => [{ items: sections.value.map((item) => ({ id: item.id, label: item.label, icon: item.icon, testid: `profile-nav-${item.id}` })) }]);
const pageTitle = computed(() => sections.value.find((item) => item.id === shown.value)?.label ?? "");
provide(SETTINGS_PAGE_TITLE, pageTitle);

/** Name and initials as typed on Profile, shown beside the avatar as they are typed; saved by ProfileEditor. */
const draft = ref({ name: "", initials: "" });
const editor = ref<InstanceType<typeof ProfileEditor> | null>(null);
const shownName = computed(() => (shown.value === "profile" ? draft.value.name : profile.value.name).trim());
const shownInitials = computed(() => (shown.value === "profile" ? draft.value.initials : profile.value.initials).trim() || autoInitials(shownName.value));

watch(profileOpen, (open) => {
  if (open) {
    section.value = profileTarget.value;
    draft.value = { name: profile.value.name, initials: profile.value.initials };
    // The developer side and the devices as the service has them now; quietly, offline is fine.
    if (account.value?.account) void act({ type: "account-refresh" }, { quiet: true });
  } else void editor.value?.save();
});
// Asked again while open (e.g. Sign in from a dialog on top): go there.
watch(profileTarget, (target) => {
  if (profileOpen.value) section.value = target;
});
function pick(id: string) {
  // Leaving Profile keeps what was typed, like leaving a field does.
  if (shown.value === "profile") void editor.value?.save();
  section.value = id as ProfileSection;
}


// The picture: picked from a file, cropped round in its own dialog over this one.
const fileInput = ref<HTMLInputElement | null>(null);
const cropping = ref<string | null>(null);
async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  cropping.value = file ? await readPicture(file) : null;
}
async function savePicture(png: string) {
  const result = await act({ type: "set-profile-picture", png });
  if (result.ok) cropping.value = null;
}
</script>

<template>
  <Dialog v-model:open="profileOpen">
    <DialogContent
      class="bg-card flex top-[calc(50%+env(titlebar-area-height,0px)/2)] h-[min(720px,calc(100vh-env(titlebar-area-height,0px)-48px))] w-[min(1040px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="profile-dialog"
      :show-close-button="false"
      :aria-describedby="undefined"
    >
      <div class="bg-background flex w-60 flex-none flex-col overflow-y-auto border-r lg:w-64">
        <!-- The banner the user picked, with Change in its corner. -->
        <div class="relative h-24 flex-none">
          <ProfileBanner :banner="profile.banner" :picture-url="profile.pictureUrl" aria-hidden="true" />
          <BannerPicker :banner="profile.banner" :picture-url="profile.pictureUrl" />
        </div>
        <!-- The avatar overlaps the banner, the name beside it on the line of its lower edge. A click on the avatar changes
             the picture, the small button removes it. -->
        <div class="flex items-end gap-3 px-5">
          <div class="profile-pop relative -mt-11 w-fit flex-none">
            <button
              type="button"
              class="group/avatar ring-background focus-visible:outline-ring relative block rounded-full ring-4 focus-visible:outline-2 focus-visible:outline-offset-4"
              data-testid="profile-picture"
              :aria-label="t('profile.changePicture')"
              :title="t('profile.changePicture')"
              @click="fileInput?.click()"
            >
              <ProfileAvatar :name="shownName" :initials="shownInitials" :picture-url="profile.pictureUrl" :size="88" />
              <span class="bg-secondary ring-background absolute right-0 bottom-0 grid size-7 place-items-center rounded-full ring-2" aria-hidden="true">
                <Camera class="size-3.5" :stroke-width="1.75" />
              </span>
            </button>
            <button
              v-if="profile.pictureUrl"
              type="button"
              class="bg-secondary text-muted-foreground hover:bg-destructive ring-background focus-visible:outline-ring absolute top-0 right-0 grid size-6 place-items-center rounded-full ring-2 transition-colors hover:text-white focus-visible:outline-2"
              data-testid="profile-remove-picture"
              :aria-label="t('profile.removePicture')"
              :title="t('profile.removePicture')"
              @click="act({ type: 'remove-profile-picture' })"
            >
              <X class="size-3.5" :stroke-width="2" />
            </button>
          </div>
          <input ref="fileInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp" data-testid="profile-file" @change="onFile" />
          <span :class="cn('min-w-0 truncate pb-1.5 text-lg font-semibold', !shownName && 'text-muted-foreground')" data-testid="profile-dialog-name">{{ shownName || t("profile.yours") }}</span>
        </div>
        <NavList
          class="nav-plates m-3 mt-4"
          group-class="rounded-xl border p-1"
          :model-value="shown"
          :label="t('profile.sections')"
          :groups="navGroups"
          @select="pick"
        />
      </div>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-16 flex-none items-center justify-between gap-4 border-b px-6 lg:px-10">
          <div class="flex min-w-0 items-center gap-2.5 text-base">
            <DialogTitle class="text-muted-foreground flex-none text-base font-medium">{{ t("profile.label") }}</DialogTitle>
            <span class="text-muted-foreground/60 flex-none" aria-hidden="true">/</span>
            <h2 class="truncate font-semibold" data-testid="profile-heading">{{ pageTitle }}</h2>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" size="icon" class="flex-none" data-testid="profile-close" :aria-label="t('profile.close')" :title="t('common.close')">
              <X :stroke-width="1.5" />
            </Button>
          </DialogClose>
        </header>
        <div class="settings-scroll min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" data-testid="profile-body">
          <div class="px-6 pt-6 pb-12 lg:px-10">
            <ProfileEditor v-if="shown === 'profile'" ref="editor" v-model:draft="draft" />
            <AccountSection v-else-if="shown === 'account'" :highlight="null" />
            <CloudCopySettings v-else-if="shown === 'cloud-copy'" />
            <MessagesSettings v-else-if="shown === 'messages'" />
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <ImageCropDialog :src="cropping" :title="t('onboarding.crop')" round @save="savePicture" @cancel="cropping = null" />
</template>
