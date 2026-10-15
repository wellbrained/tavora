<script setup lang="ts">
// Ctrl+/: every keyboard shortcut Tavora has, grouped.
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { shortcutsOpen } from "../host";
import { SHORTCUT_GROUPS } from "../shortcuts";
</script>

<template>
  <Dialog v-model:open="shortcutsOpen">
    <DialogContent class="gap-5 sm:max-w-[480px]" data-testid="shortcuts">
      <div class="flex flex-col gap-1">
        <DialogTitle class="text-lg">Keyboard shortcuts</DialogTitle>
        <DialogDescription>They work everywhere in Tavora, also while a module panel has focus.</DialogDescription>
      </div>
      <section v-for="group in SHORTCUT_GROUPS" :key="group.title" class="flex flex-col">
        <h3 class="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">{{ group.title }}</h3>
        <ul>
          <li v-for="row in group.rows" :key="row.action" class="flex min-h-9 items-center gap-4 border-b py-1.5 last:border-b-0">
            <span class="min-w-0 flex-1 text-sm">{{ row.action }}</span>
            <span class="flex flex-none items-center gap-1">
              <kbd
                v-for="key in row.keys"
                :key="key"
                class="bg-secondary text-foreground min-w-6 rounded-sm border border-b-2 px-1.5 py-0.5 text-center font-mono text-xs"
                >{{ key }}</kbd
              >
            </span>
          </li>
        </ul>
      </section>
    </DialogContent>
  </Dialog>
</template>
