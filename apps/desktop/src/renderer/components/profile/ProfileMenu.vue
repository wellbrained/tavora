<script setup lang="ts">
import { Camera } from "@lucide/vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { act, showToast, state, useFloating } from "../../host";
import ImageCropDialog from "../ImageCropDialog.vue";
import ProfileAvatar from "./ProfileAvatar.vue";

// The player's avatar in the rail footer. A click opens a small card above
// it to change the name and picture; there is no account behind it yet.
defineProps<{ expanded: boolean }>();

const MAX_NAME = 32;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

const profile = computed(() => state.value!.profile);
const open = ref(false);
/** The name as typed; the saved one can lag behind while typing. */
const draft = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
/** The picked image waiting in the crop dialog. */
const cropping = ref<string | null>(null);

const track = useFloating();
function onOpenChange(value: boolean) {
  open.value = value;
  track(value);
  if (value) draft.value = profile.value.name;
}

let nameTimer: ReturnType<typeof setTimeout> | undefined;
function onName(value: string) {
  draft.value = value;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => void act({ type: "set-profile-name", name: value }), 250);
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
  if (result.ok) cropping.value = null;
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
          <ProfileAvatar :name="profile.name" :picture-url="profile.pictureUrl" :size="32" />
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
          <ProfileAvatar :name="draft" :picture-url="profile.pictureUrl" :size="88" />
          <span
            class="absolute inset-0 grid place-items-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100"
          >
            <Camera class="size-6 text-white" :stroke-width="1.5" />
          </span>
        </button>
        <input ref="fileInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp" data-testid="profile-file" @change="onFile" />

        <Input
          :model-value="draft"
          class="text-center"
          placeholder="Add your name"
          aria-label="Your name"
          autocomplete="off"
          spellcheck="false"
          :maxlength="MAX_NAME"
          data-testid="profile-name"
          @update:model-value="onName(String($event))"
        />

        <Button
          v-if="profile.pictureUrl"
          variant="ghost"
          size="sm"
          class="text-muted-foreground"
          data-testid="profile-remove-picture"
          @click="act({ type: 'remove-profile-picture' })"
        >
          Remove picture
        </Button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>

  <ImageCropDialog :src="cropping" title="Crop your picture" round @save="savePicture" @cancel="cropping = null" />
</template>
