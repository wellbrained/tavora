<script setup lang="ts">
// Copy to… on the Overlay page, next to the setup picker: lists the games (those with frames and those without), copies the
// frames of the setup shown to the one picked, and asks first when that game has frames of its own: replace them, add to them,
// or cancel. The copying itself is the main process's (overlay-layout.ts); a note says what happened (OverlayCopied.vue).
import { Copy } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { t } from "../../i18n";
import { send, view } from "./layout-state";

const targets = computed(() => view.value?.copyTargets ?? []);
const hint = computed(() => (!view.value?.items.length ? t("overlays.copy.hintEmpty") : targets.value.length === 0 ? t("overlays.copy.hintNoGames") : null));

/** The game the user picked that has frames of its own, while the dialog asks what to do. */
const asking = ref<string | null>(null);
const target = computed(() => targets.value.find((game) => game.id === asking.value) ?? null);

/** Runs after the menu has closed, so the dialog it opens keeps the focus. */
function pick(id: string) {
  setTimeout(() => {
    const game = targets.value.find((candidate) => candidate.id === id);
    if (!game) return;
    // A game without frames takes the copy right away.
    if (game.frames === 0) send({ type: "copy-setup", to: id, mode: "replace" });
    else asking.value = id;
  }, 0);
}

function copy(mode: "replace" | "add") {
  if (target.value) send({ type: "copy-setup", to: target.value.id, mode });
  asking.value = null;
}
</script>

<template>
  <!-- A disabled button shows no hint of its own, so the hint sits on its wrapper. -->
  <span class="inline-flex" :title="hint ?? undefined" data-testid="layout-copy-hint">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="secondary" size="sm" :disabled="hint !== null" :aria-description="hint ?? undefined" data-testid="layout-copy">
          <Copy :stroke-width="1.5" />{{ t("overlays.copy.button") }}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" class="max-h-80 max-w-72 min-w-52" data-testid="layout-copy-menu">
        <DropdownMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ t("overlays.copy.menu") }}</DropdownMenuLabel>
        <DropdownMenuItem v-for="game in targets" :key="game.id" :data-testid="`layout-copy-option-${game.id}`" @select="pick(game.id)">
          <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
          <span class="text-muted-foreground flex-none text-xs">{{ game.frames > 0 ? t("overlays.copy.frames", { count: game.frames }) : t("overlays.copy.noFrames") }}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </span>
  <Dialog :open="target !== null" @update:open="(open: boolean) => !open && (asking = null)">
    <DialogContent v-if="target" class="top-[12vh] translate-y-0 gap-4 sm:max-w-[460px]" data-testid="layout-copy-dialog" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ t("overlays.copy.ask", { game: target.name, count: target.frames }) }}</DialogTitle>
        <DialogDescription>{{ t("overlays.copy.askText") }}</DialogDescription>
      </DialogHeader>
      <div class="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" autofocus data-testid="layout-copy-cancel" @click="asking = null">{{ t("common.cancel") }}</Button>
        <Button type="button" variant="secondary" data-testid="layout-copy-add" @click="copy('add')">{{ t("overlays.copy.add") }}</Button>
        <Button type="button" variant="destructive" data-testid="layout-copy-replace" @click="copy('replace')">{{ t("overlays.copy.replace") }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
