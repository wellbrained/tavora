<script setup lang="ts">
import { Camera, Check } from "@lucide/vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { act, showToast, state, useFloating } from "../../host";
import ImageCropDialog from "../ImageCropDialog.vue";
import { autoInitials } from "./initials";
import ProfileAvatar from "./ProfileAvatar.vue";

// The player's avatar in the rail footer. A click opens a small card above
// it to change the name, initials and picture; there is no account behind it
// yet. Name and initials are kept with Save (closing the card drops unsaved
// edits); a picture is kept as soon as its crop is saved.
defineProps<{ expanded: boolean }>();

const MAX_NAME = 32;
const MAX_INITIALS = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

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

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!TYPES.includes(file.type)) return showToast("Pick a PNG, JPEG or WebP image.");
  if (file.size > MAX_FILE_BYTES) return showToast("Pick an image of at most 10 MB.");
  const reader = new FileReader();
  reader.onload = () => {
    open.value = false;
    track(false);
    cropping.value = reader.result as string;
  };
  reader.onerror = () => showToast("That image could not be read.");
  reader.readAsDataURL(file);
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
        :aria-label="profile.name.trim() ? `Profile: ${profile.name.trim()}` : 'Profile'"
        :title="expanded ? undefined : profile.name.trim() || 'Profile'"
      >
        <!-- A 48 px slot keeps the avatar on the same centre line as the tiles. -->
        <span class="flex w-12 flex-none justify-center">
          <ProfileAvatar :name="profile.name" :initials="profile.initials" :picture-url="profile.pictureUrl" :size="32" />
        </span>
        <span v-if="expanded" class="truncate text-sm font-medium">{{ profile.name.trim() || "Profile" }}</span>
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="top"
        align="start"
        :side-offset="8"
        :collision-padding="8"
        class="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=top]:slide-in-from-bottom-2 z-50 flex w-72 flex-col items-center gap-4 rounded-lg border p-4 shadow-md"
        data-testid="profile-card"
      >
        <button
          type="button"
          class="group/avatar focus-visible:ring-ring relative rounded-full focus-visible:ring-2 focus-visible:outline-none"
          data-testid="profile-picture"
          aria-label="Change picture"
          title="Change picture"
          @click="pickPicture"
        >
          <ProfileAvatar :name="draft.name" :initials="draft.initials" :picture-url="profile.pictureUrl" :size="88" />
          <span
            class="absolute inset-0 grid place-items-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100"
          >
            <Camera class="size-6 text-white" :stroke-width="1.5" />
          </span>
        </button>
        <input ref="fileInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp" data-testid="profile-file" @change="onFile" />

        <form class="flex w-full flex-col gap-4" @submit.prevent="save">
          <div class="flex gap-2">
            <label class="flex min-w-0 flex-1 flex-col gap-1.5">
              <span class="text-muted-foreground text-xs">Name</span>
              <Input
                v-model="draft.name"
                placeholder="Add your name"
                autocomplete="off"
                spellcheck="false"
                :maxlength="MAX_NAME"
                data-testid="profile-name"
              />
            </label>
            <label class="flex w-20 flex-none flex-col gap-1.5">
              <span class="text-muted-foreground text-xs">Initials</span>
              <Input
                v-model="draft.initials"
                class="text-center"
                :placeholder="autoInitials(draft.name) || 'Auto'"
                autocomplete="off"
                spellcheck="false"
                :maxlength="MAX_INITIALS"
                title="Optional. Leave empty to use the initials of your name."
                data-testid="profile-initials"
              />
            </label>
          </div>

          <div class="flex items-center gap-2">
            <Button
              v-if="profile.pictureUrl"
              type="button"
              variant="ghost"
              size="sm"
              class="text-muted-foreground -ml-2"
              data-testid="profile-remove-picture"
              @click="act({ type: 'remove-profile-picture' })"
            >
              Remove picture
            </Button>
            <Button type="submit" class="ml-auto min-w-20" :disabled="!dirty || saving" data-testid="profile-save">
              <template v-if="saved && !dirty"><Check :stroke-width="2" /> Saved</template>
              <template v-else>{{ saving ? "Saving…" : "Save" }}</template>
            </Button>
          </div>
        </form>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>

  <ImageCropDialog :src="cropping" title="Crop your picture" round @save="savePicture" @cancel="closeCrop" />
</template>
