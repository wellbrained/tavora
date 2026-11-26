<script setup lang="ts">
// The small bar that opens under a link when it is clicked: its address, and
// Open, Edit and Remove. Ctrl+click opens a link without it.
import { ExternalLink, Pencil, Unlink } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Toolbar } from "@tavora/official-ui/components/ui/toolbar";
import { computed } from "vue";
import { t } from "./i18n";

const props = defineProps<{ href: string; left: number; top: number }>();
const emit = defineEmits<{ open: []; edit: []; remove: [] }>();

/** Only web addresses can be opened from here; a mail link can still be edited or removed. */
const canOpen = computed(() => /^https?:/i.test(props.href));
/** Keeps the bar inside the panel when the link is near its right edge. */
const style = computed(() => ({ left: `${Math.max(8, Math.min(props.left, window.innerWidth - 280))}px`, top: `${props.top}px` }));
</script>

<template>
  <Toolbar
    variant="floating"
    class="fixed z-(--layer-floating) max-w-[272px] pl-2.5 text-xs"
    :style="style"
    :label="t('link.actions')"
    data-link-popover
    data-testid="link-popover"
  >
    <span class="text-muted-foreground min-w-0 flex-1 truncate" :title="href" data-testid="link-href">{{ href }}</span>
    <Button v-if="canOpen" variant="ghost" size="icon-sm" class="flex-none" data-testid="link-open" :aria-label="t('link.open')" :title="t('link.openHint')" @click="emit('open')">
      <ExternalLink />
    </Button>
    <Button variant="ghost" size="icon-sm" class="flex-none" data-testid="link-edit" :aria-label="t('link.edit')" :title="t('link.edit')" @click="emit('edit')">
      <Pencil />
    </Button>
    <Button variant="ghost" size="icon-sm" class="flex-none" data-testid="link-remove" :aria-label="t('link.remove')" :title="t('link.remove')" @click="emit('remove')">
      <Unlink />
    </Button>
  </Toolbar>
</template>
