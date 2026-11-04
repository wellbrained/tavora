<script setup lang="ts">
// At the bottom of the rail, above the other items, while a new version of Tavora is on its way. It never
// interrupts: it breathes out twice when it shows up, a ring along its edge fills while the version downloads, and a
// press opens a popover beside it with what is new, the download's progress and Restart now. Restarting is always the
// user's press; otherwise the update installs when Tavora is closed.
import { ArrowDownToLine, RefreshCw } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@tavora/official-ui/components/ui/popover";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { cn } from "@tavora/official-ui/lib/utils";
import { act, state, useFloating } from "../host";
import { t } from "../i18n";
import RailFooterTile from "./RailFooterTile.vue";
import RailTooltip from "./RailTooltip.vue";

defineProps<{ expanded: boolean }>();

/** The changes shown at first; Read more shows the rest. */
const KEY_NOTES = 3;

const update = computed(() => state.value!.update);
const found = computed(() => {
  const u = update.value;
  return u.status === "available" || u.status === "downloading" || u.status === "ready" ? u : null;
});
const failed = computed(() => found.value?.status === "available" && found.value.failed);

const label = computed(() => {
  const u = found.value;
  if (!u) return "";
  if (u.status === "ready") return t("update.marker.ready");
  if (u.status === "downloading") return t("update.marker.downloading", { version: u.version });
  return t("update.marker.available", { version: u.version });
});

const title = computed(() => {
  const u = found.value;
  if (!u) return "";
  if (failed.value) return t("update.popover.failed");
  if (u.status === "ready") return t("update.popover.ready", { version: u.version });
  if (u.status === "downloading") return t("update.popover.downloading", { version: u.version });
  return t("update.popover.available", { version: u.version });
});

const progress = computed(() => {
  const u = found.value;
  if (u?.status === "downloading") return u.percent;
  if (u?.status === "ready") return 100;
  return undefined;
});

const open = ref(false);
const setFloating = useFloating();
watch(open, (value) => setFloating(value));
// The popover goes when the version does (installed, or the preview ended).
watch(found, (u) => u === null && (open.value = false));

// Closing by Escape gives the focus back to the marker, for the keyboard. Closing any other way (a click beside it,
// often into a module panel) leaves it where it went: handing it back would light the marker's focus outline.
let closedByKey = false;
function closeAutoFocus(event: Event) {
  if (!closedByKey) event.preventDefault();
  closedByKey = false;
}

const allNotes = ref(false);
watch(open, (value) => value || (allNotes.value = false));
const notes = computed(() => {
  const all = found.value?.notes ?? [];
  return allNotes.value ? all : all.slice(0, KEY_NOTES);
});
const more = computed(() => !allNotes.value && (found.value?.notes.length ?? 0) > KEY_NOTES);
</script>

<template>
  <Popover v-if="found" v-model:open="open">
    <RailTooltip :text="label" :disabled="expanded || open">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="update-marker text-primary hover:bg-accent mx-2 flex items-center gap-2.5 rounded-lg px-1 transition-colors group-data-[expanded=true]/rail:px-2 group-data-[expanded=true]/rail:py-[5px] focus-visible:-outline-offset-2"
          data-rail-item
          data-testid="rail-update"
          :data-status="found.status"
          :aria-label="label"
        >
          <RailFooterTile class="update-arrive" :progress="progress">
            <RefreshCw v-if="found.status === 'ready'" class="size-5" :stroke-width="1.5" />
            <ArrowDownToLine v-else class="size-5" :stroke-width="1.5" />
          </RailFooterTile>
          <span v-if="expanded" class="truncate text-sm font-medium">{{ label }}</span>
        </button>
      </PopoverTrigger>
    </RailTooltip>
    <PopoverContent side="right" align="end" :side-offset="10" class="w-[23rem] p-0" :aria-label="title" data-testid="update-popover" @escape-key-down="closedByKey = true" @close-auto-focus="closeAutoFocus">
      <div class="p-4">
        <div class="flex items-baseline gap-3">
          <h2 class="text-sm font-semibold" data-testid="update-popover-title">{{ title }}</h2>
          <span v-if="!failed" class="text-muted-foreground ml-auto text-xs whitespace-nowrap">{{ t("update.popover.current", { version: state!.appVersion }) }}</span>
        </div>
        <p v-if="failed" class="text-muted-foreground mt-1 text-sm">{{ t("update.popover.failedText") }}</p>
        <template v-else-if="notes.length">
          <ul class="mt-3 flex flex-col gap-1.5 text-sm" data-testid="update-popover-notes">
            <li v-for="note in notes" :key="note" class="flex gap-2">
              <span class="bg-primary mt-[0.5em] size-1.5 flex-none rounded-full" aria-hidden="true" />
              <span>{{ note }}</span>
            </li>
          </ul>
          <Button v-if="more" variant="link" size="xs" class="mt-1.5 h-auto px-0" data-testid="update-popover-more" @click="allNotes = true">{{ t("update.popover.more") }}</Button>
        </template>
      </div>
      <div :class="cn('flex min-h-14 items-center gap-3 border-t px-4 py-3', found.status === 'downloading' && 'min-h-0 py-4')">
        <template v-if="found.status === 'downloading'">
          <Progress :model-value="found.percent" class="flex-1" :aria-label="title" data-testid="update-popover-progress" />
        </template>
        <template v-else-if="found.status === 'ready'">
          <span class="text-muted-foreground flex-1 text-xs">{{ t("update.popover.readyText") }}</span>
          <Button size="sm" data-testid="update-popover-restart" @click="act({ type: 'restart-to-update' })">{{ t("common.restartNow") }}</Button>
        </template>
        <template v-else>
          <span class="flex-1" />
          <Button size="sm" data-testid="update-popover-download" @click="act({ type: 'download-update' })">{{ failed ? t("update.popover.retry") : t("settings.updates.download") }}</Button>
        </template>
      </div>
    </PopoverContent>
  </Popover>
</template>
