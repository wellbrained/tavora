<script setup lang="ts">
import AddGameDialog from "./components/AddGameDialog.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import GameRail from "./components/GameRail.vue";
import PromptDialog from "./components/PromptDialog.vue";
import SettingsDialog from "./components/settings/SettingsDialog.vue";
import { dialog, state, toast } from "./host";
import GameWorkspace from "./pages/GameWorkspace.vue";
import WelcomePage from "./pages/WelcomePage.vue";
</script>

<template>
  <div v-if="state" class="flex h-full">
    <GameRail />
    <div class="relative h-full min-w-0 flex-1">
      <GameWorkspace v-if="state.screen === 'game' && state.currentGameId" :key="state.currentGameId" />
      <template v-else>
        <WelcomePage />
        <!-- Lets the window be moved from the empty top edge of Home. -->
        <div class="app-drag absolute inset-x-0 top-0 h-12" aria-hidden="true" />
      </template>
    </div>

    <SettingsDialog />
    <AddGameDialog v-if="dialog?.kind === 'add-game'" />
    <PromptDialog v-else-if="dialog?.kind === 'prompt'" :key="dialog.title" :request="dialog" />
    <ConfirmDialog v-else-if="dialog?.kind === 'confirm'" :key="dialog.title" :request="dialog" />

    <!-- Over the toolbar: module panels are native views drawn above this
         page, so anything lower would be hidden behind them. -->
    <div class="fixed top-2 left-1/2 z-[60] -translate-x-1/2" role="status" aria-live="polite">
      <p v-if="toast" class="bg-secondary rounded-lg border px-4 py-2 text-sm shadow-lg" data-testid="toast">{{ toast }}</p>
    </div>
  </div>
</template>
