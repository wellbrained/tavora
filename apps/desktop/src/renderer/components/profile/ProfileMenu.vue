<script setup lang="ts">
import { Camera, Check, X } from "@lucide/vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { cn } from "@/lib/utils";
import { act, state, useFloating } from "../../host";
import { t } from "../../i18n";
import ImageCropDialog from "../ImageCropDialog.vue";
import { autoInitials } from "./initials";
import { readPicture } from "./picture";
import ProfileAvatar from "./ProfileAvatar.vue";

// The player's avatar in the rail footer. A click opens a small card above
// it to change the name, initials and picture; there is no account behind it
// yet. Name and initials are kept with Save (closing the card drops unsaved
// edits); a picture is kept as soon as its crop is saved.
defineProps<{ expanded: boolean }>();

const MAX_NAME = 32;
const MAX_INITIALS = 3;

const profile = computed(() => state.value!.profile);
const open = ref(false);
/** Name and initials as typed, until saved. */
const draft = ref({ name: "", initials: "" });
const dirty = computed(() => draft.value.name !== profile.value.name || draft.value.initials !== profile.value.initials);
const saving = ref(false);
/** Shows "Saved" on the button for a moment after a save. */
const saved = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;
const fileInput = ref<HTMLInputElement | null>(null);
/** The picked image waiting in the crop dialog. */
const cropping = ref<string | null>(null);

const track = useFloating();
function onOpenChange(value: boolean) {
  open.value = value;
  track(value);
  if (value) {
    draft.value = { name: profile.value.name, initials: profile.value.initials };
    saved.value = false;
  }
}

async function save() {
  if (!dirty.value || saving.value) return;
  saving.value = true;
  const result = await act({ type: "save-profile", name: draft.value.name, initials: draft.value.initials });
  saving.value = false;
  if (!result.ok) return;
  // Main may have tidied the values (spaces in initials, length).
  draft.value = { name: profile.value.name, initials: profile.value.initials };
  saved.value = true;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (saved.value = false), 2000);
}

function pickPicture() {
  fileInput.value?.click();
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const picture = file ? await readPicture(file) : null;
  if (!picture) return;
  open.value = false;
  track(false);
  cropping.value = picture;
}

async function savePicture(png: string) {
  const result = await act({ type: "set-profile-picture", png });
  if (result.ok) closeCrop();
}

/** Back to the card, keeping any unsaved name or initials. */
function closeCrop() {
  cropping.value = null;
  open.value = true;
  track(true);
}
</script>

<template>
  <PopoverRoot :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'group text-muted-foreground hover:text-foreground mx-2 flex h-10 items-center gap-3 rounded-lg px-1 transition-colors data-[state=open]:text-foreground',
            expanded && 'hover:bg-accent data-[state=open]:bg-accent',
          )
        "
        data-rail-item
        data-testid="rail-profile"
        :aria-label="profile.name.trim() ? t('profile.named', { name: profile.name.trim() }) : t('profile.label')"
        :title="expanded ? undefined : profile.name.trim() || t('profile.label')"
      >
        <!-- A 48 px slot keeps the avatar on the same centre line as the tiles. -->
        <span class="flex w-12 flex-none justify-center">
          <ProfileAvatar :name="profile.name" :initials="profile.initials" :picture-url="profile.pictureUrl" :size="32" />
        </span>
        <span v-if="expanded" class="truncate text-sm font-medium">{{ profile.name.trim() || t("profile.label") }}</span>
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="top"
        align="start"
        :side-offset="8"
        :collision-padding="8"
        class="profile-card bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 data-[side=top]:slide-in-from-bottom-3 border-primary/30 z-50 w-[300px] origin-(--reka-popover-content-transform-origin) overflow-hidden rounded-xl border shadow-xl shadow-black/40 duration-200"
        data-testid="profile-card"
      >
        <!-- Banner: a blurred copy of the picture, or a warm pattern without one. -->
        <div class="profile-banner relative h-[72px] overflow-hidden" aria-hidden="true">
          <img v-if="profile.pictureUrl" :src="profile.pictureUrl" alt="" class="absolute inset-0 size-full scale-150 object-cover blur-xl brightness-[0.55] saturate-150" />
        </div>

        <div class="flex flex-col gap-4 px-4 pb-4">
          <div class="flex items-end gap-3">
            <!-- The avatar overlaps the banner; removing the picture sits on it. -->
            <div class="profile-pop relative -mt-10 flex-none">
              <button
                type="button"
                class="group/avatar ring-popover focus-visible:outline-ring relative block rounded-full ring-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                data-testid="profile-picture"
                :aria-label="t('profile.changePicture')"
                :title="t('profile.changePicture')"
                @click="pickPicture"
              >
                <ProfileAvatar :name="draft.name" :initials="draft.initials" :picture-url="profile.pictureUrl" :size="80" />
                <span
                  class="absolute inset-0 grid place-items-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100"
                >
                  <Camera class="size-6 text-white" :stroke-width="1.5" />
                </span>
              </button>
              <button
                v-if="profile.pictureUrl"
                type="button"
                class="bg-secondary text-muted-foreground hover:bg-destructive ring-popover focus-visible:outline-ring absolute top-0 right-0 grid size-6 place-items-center rounded-full ring-2 transition-colors hover:text-white focus-visible:outline-2"
                data-testid="profile-remove-picture"
                :aria-label="t('profile.removePicture')"
                :title="t('profile.removePicture')"
                @click="act({ type: 'remove-profile-picture' })"
              >
                <X class="size-3.5" :stroke-width="2" />
              </button>
            </div>
            <div class="flex min-w-0 flex-1 items-center gap-2 pb-1">
              <span :class="cn('truncate text-lg font-semibold', !draft.name.trim() && 'text-muted-foreground')">
                {{ draft.name.trim() || t("profile.yours") }}
              </span>
              <span
                v-if="draft.initials.trim() || autoInitials(draft.name)"
                class="bg-secondary text-primary flex-none rounded-sm px-1.5 py-0.5 text-xs font-semibold"
                :title="t('profile.initials')"
              >
                {{ draft.initials.trim() || autoInitials(draft.name) }}
              </span>
            </div>
          </div>
          <input ref="fileInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp" data-testid="profile-file" @change="onFile" />

        </div>

        <form class="flex w-full flex-col" @submit.prevent="save">
          <div class="flex gap-2 px-4 pb-4">
            <label class="flex min-w-0 flex-1 flex-col gap-1.5">
              <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("profile.name") }}</span>
              <Input
                v-model="draft.name"
                :placeholder="t('profile.namePlaceholder')"
                autocomplete="off"
                spellcheck="false"
                :maxlength="MAX_NAME"
                data-testid="profile-name"
              />
            </label>
            <label class="flex w-20 flex-none flex-col gap-1.5">
              <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("profile.initials") }}</span>
              <Input
                v-model="draft.initials"
                class="text-center"
                :placeholder="autoInitials(draft.name) || t('profile.initialsAuto')"
                autocomplete="off"
                spellcheck="false"
                :maxlength="MAX_INITIALS"
                :title="t('profile.initialsHint')"
                data-testid="profile-initials"
              />
            </label>
          </div>

          <!-- Footer bar, apart from the fields. -->
          <div class="bg-background/50 flex min-h-13 items-center gap-3 border-t px-4 py-2.5">
            <span class="text-muted-foreground text-xs" role="status">
              {{ dirty ? t("profile.unsaved") : saved ? t("profile.allSaved") : "" }}
            </span>
            <Button
              type="submit"
              :variant="dirty || saving ? 'default' : 'secondary'"
              class="ml-auto min-w-20"
              :disabled="!dirty || saving"
              data-testid="profile-save"
            >
              <template v-if="saved && !dirty"><Check :stroke-width="2" /> {{ t("profile.saved") }}</template>
              <template v-else>{{ saving ? t("profile.saving") : t("common.save") }}</template>
            </Button>
          </div>
        </form>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>

  <ImageCropDialog :src="cropping" :title="t('onboarding.crop')" round @save="savePicture" @cancel="closeCrop" />
</template>
