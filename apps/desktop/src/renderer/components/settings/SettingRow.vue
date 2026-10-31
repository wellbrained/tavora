<script setup lang="ts">
// One setting: its name and one short line on what it does, with the control on the right. Rows sit in a SettingGroup,
// separated by dividers. `setting` is its id in settings-index.ts, which search results lead to. In a narrow window
// the control moves under the text instead of squeezing it.
//
// The short line says what it does; anything more (how it works, privacy, what each choice means) goes in `details`,
// shown beside the name when the pointer rests on it or it gets keyboard focus, so pages stay short. A setting in
// NEW_SETTINGS says New. A row with `opens` leads to a page of its own: the whole row is the button, with a chevron,
// and its `icon` in a tile in front, so it reads as a way somewhere rather than a setting.
import { ChevronRight } from "@lucide/vue";
import { computed, ref, type Component } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Tooltip } from "@tavora/official-ui/components/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../../i18n";
import { isNewSetting } from "./new-settings";
import { useDetails } from "./use-details";

const props = defineProps<{ label: string; description?: string; details?: string; setting?: string; highlighted?: boolean; opens?: boolean; icon?: Component }>();
const emit = defineEmits<{ open: [] }>();

const isNew = computed(() => isNewSetting(props.setting));
const name = ref<HTMLElement | null>(null);
const tip = useDetails();
</script>

<template>
  <component
    :is="opens ? 'button' : 'div'"
    :type="opens ? 'button' : undefined"
    :class="
      cn(
        '-mx-5 flex min-h-16 flex-wrap items-center gap-x-6 gap-y-3 border-b px-5 py-3.5 text-left transition-colors duration-500 last:border-b-0',
        opens && 'hover:bg-accent/60 focus-visible:outline-ring w-[calc(100%+2.5rem)] cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2',
        highlighted && 'bg-primary/10',
      )
    "
    :data-setting="setting"
    :data-highlighted="highlighted || undefined"
    @click="opens && emit('open')"
    @focus="opens && details && name && tip.focus($event, name)"
    @blur="opens && tip.hide()"
  >
    <slot name="lead" />
    <span v-if="icon" class="bg-muted text-muted-foreground flex size-9 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
      <component :is="icon" class="size-[18px]" :stroke-width="1.75" />
    </span>
    <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
      <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          v-if="details"
          ref="name"
          class="decoration-input cursor-help font-medium underline decoration-dotted underline-offset-4"
          :tabindex="opens ? undefined : 0"
          data-testid="setting-details"
          @pointerenter="tip.show($event.currentTarget as Element)"
          @pointerleave="tip.hide()"
          @focus="tip.focus($event, $event.currentTarget as Element)"
          @blur="tip.hide()"
          >{{ label }}</span
        >
        <span v-else class="font-medium">{{ label }}</span>
        <Badge v-if="isNew" class="py-0 text-[10px] font-semibold uppercase" data-testid="setting-new">{{ t("settings.new") }}</Badge>
        <slot name="badges" />
      </span>
      <span v-if="description" class="text-muted-foreground text-sm">{{ description }}</span>
      <slot name="below" />
      <!-- Screen readers get the details with the row; the card is for the eyes. -->
      <span v-if="details" class="sr-only">{{ details }}</span>
    </div>
    <slot />
    <ChevronRight v-if="opens" class="text-muted-foreground size-4 flex-none" :stroke-width="1.75" aria-hidden="true" />
    <Tooltip v-if="details" side="right" :open="tip.open.value" :anchor="tip.anchor.value" :description="details" @dismiss="tip.hide()" />
  </component>
</template>
