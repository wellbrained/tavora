<script setup lang="ts">
// A small picture of a style, drawn from its looks in the colours in use: a panel on the canvas (flat, raised or
// glass), its content (plain bars or an inset screen), a button (soft, keycap or capsule) and, with a status light, its
// dot. Settings > Appearance shows it in the Style list, the way ThemePreview shows a theme.
import { computed } from "vue";
import type { StyleView } from "../../../shared/host-api";

const props = defineProps<{ look: StyleView; size?: "sm" | "md" }>();

const looks = computed(() => props.look.looks);
/** The style's corner, scaled down to the picture (Classic shows a middle one: its corners come from the theme). */
const corner = computed(() => `${Math.round((props.look.id === "tavora.classic" ? 8 : props.look.radius) / 2.5)}px`);
const button = computed(() => (looks.value.buttons === "capsule" ? "999px" : looks.value.buttons === "keycap" ? "1px" : corner.value));
</script>

<template>
  <!-- A div, not a span: the Style list hides a row's first span (where the tick would be). -->
  <div
    :class="['style-preview relative block flex-none overflow-hidden rounded-[5px] border', size === 'md' ? 'h-10 w-[60px]' : 'h-8 w-12']"
    :data-surface="looks.surface"
    :data-buttons="looks.buttons"
    aria-hidden="true"
    data-testid="style-preview"
  >
    <span class="panel absolute inset-[5px] block" :style="{ borderRadius: corner }">
      <span v-if="looks.content === 'inset'" class="screen absolute inset-x-[3px] top-[3px] bottom-[9px] block" />
      <template v-else>
        <span class="bg-muted-foreground/45 absolute top-[5px] left-[5px] block h-[2px] w-3/5 rounded-full" />
        <span class="bg-muted-foreground/30 absolute top-[10px] left-[5px] block h-[2px] w-2/5 rounded-full" />
      </template>
      <span class="key bg-primary-fill absolute bottom-[3px] left-[4px] block h-[4px] w-[11px]" :style="{ borderRadius: button }" />
      <span v-if="looks.status === 'led'" class="bg-primary absolute top-[5px] right-[5px] z-10 block size-[3px] rounded-full shadow-[0_0_3px_var(--primary)]" />
    </span>
  </div>
</template>

<style scoped>
.style-preview {
  background: var(--background);
}
.style-preview[data-surface="glass"] {
  background:
    radial-gradient(60% 70% at 12% 15%, color-mix(in srgb, var(--primary) 40%, transparent), transparent 70%),
    radial-gradient(60% 70% at 90% 10%, color-mix(in srgb, var(--info) 40%, transparent), transparent 70%),
    radial-gradient(60% 70% at 70% 100%, color-mix(in srgb, var(--success) 35%, transparent), transparent 70%),
    var(--background);
}
.panel {
  background: var(--card);
  border: 1px solid var(--border);
}
[data-surface="raised"] .panel {
  background: linear-gradient(color-mix(in srgb, white 6%, var(--card)), var(--card));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, white 35%, transparent),
    0 1px 2px color-mix(in srgb, black 30%, transparent);
}
[data-surface="glass"] .panel {
  background: color-mix(in srgb, var(--card) 65%, transparent);
  border-color: color-mix(in srgb, white 50%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 60%, transparent);
}
.screen {
  background: color-mix(in srgb, black 85%, var(--background));
  border-radius: 1px;
}
.key {
  box-shadow: 0 1px 0 color-mix(in srgb, black 35%, transparent);
}
</style>
