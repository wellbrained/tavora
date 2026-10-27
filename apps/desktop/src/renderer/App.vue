<script setup lang="ts">
import { TooltipProvider } from "reka-ui";
import AddGameDialog from "./components/AddGameDialog.vue";
import AddModuleDialog from "./components/AddModuleDialog.vue";
import CloudCopyDialog from "./components/CloudCopyDialog.vue";
import PairingDialog from "./components/PairingDialog.vue";
import CopyExampleDialog from "./components/developer/CopyExampleDialog.vue";
import DeveloperStartDialog from "./components/developer/DeveloperStartDialog.vue";
import RecoveryAskDialog from "./components/settings/RecoveryAskDialog.vue";
import PublishDialog from "./components/developer/PublishDialog.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import GrantDialog from "./components/GrantDialog.vue";
import HotkeyDialog from "./components/HotkeyDialog.vue";
import LinkChoiceDialog from "./components/LinkChoiceDialog.vue";
import NavigationChoiceDialog from "./components/NavigationChoiceDialog.vue";
import WorkspaceRail from "./components/WorkspaceRail.vue";
import GameSwitchDialog from "./components/GameSwitchDialog.vue";
import ModuleMenu from "./components/menus/ModuleMenu.vue";
import PromptDialog from "./components/PromptDialog.vue";
import SearchDialog from "./components/SearchDialog.vue";
import ShareIconsDialog from "./components/ShareIconsDialog.vue";
import SteamImportDialog from "./components/SteamImportDialog.vue";
import SettingsDialog from "./components/settings/SettingsDialog.vue";
import InboxDialogs from "./components/messages/InboxDialogs.vue";
import { dialog, state, toast } from "./host";
import WorkspacePage from "./pages/WorkspacePage.vue";
import OnboardingPage from "./pages/OnboardingPage.vue";
import WelcomePage from "./pages/WelcomePage.vue";
</script>

<template>
  <div v-if="state" class="flex h-full">
    <TooltipProvider :delay-duration="150" :skip-delay-duration="500">
      <WorkspaceRail />
    </TooltipProvider>
    <div class="relative h-full min-w-0 flex-1">
      <WorkspacePage v-if="state.screen === 'workspace' && state.currentWorkspaceId" :key="state.currentWorkspaceId" />
      <template v-else>
        <OnboardingPage v-if="!state.library.onboarded" />
        <WelcomePage v-else />
        <!-- Lets the window be moved from the empty top edge of Home. -->
        <div class="app-drag absolute inset-x-0 top-0 h-12" aria-hidden="true" />
      </template>
    </div>

    <SettingsDialog />
    <SearchDialog />
    <AddGameDialog v-if="dialog?.kind === 'add-game'" />
    <SteamImportDialog v-else-if="dialog?.kind === 'steam-import'" />
    <AddModuleDialog v-else-if="dialog?.kind === 'add-module'" />
    <ShareIconsDialog v-else-if="dialog?.kind === 'share-icons'" :request="dialog" />
    <PromptDialog v-else-if="dialog?.kind === 'prompt'" :key="dialog.title" :request="dialog" />
    <LinkChoiceDialog v-else-if="dialog?.kind === 'link-choice'" :url="dialog.url" />
    <NavigationChoiceDialog v-else-if="dialog?.kind === 'navigation-choice'" :panel="dialog.panel" :content="dialog.content" />
    <GameSwitchDialog v-else-if="dialog?.kind === 'game-switch'" :key="dialog.gameId" :game-id="dialog.gameId" />
    <ConfirmDialog v-else-if="dialog?.kind === 'confirm'" :key="dialog.title" :request="dialog" />
    <GrantDialog v-else-if="dialog?.kind === 'grant'" :key="dialog.moduleId" :request="dialog" />
    <DeveloperStartDialog v-else-if="dialog?.kind === 'developer-start'" :then="dialog.then" />
    <RecoveryAskDialog v-else-if="dialog?.kind === 'recovery-ask'" />
    <CopyExampleDialog v-else-if="dialog?.kind === 'copy-example'" :key="dialog.moduleId" :module-id="dialog.moduleId" />
    <InboxDialogs />
    <ModuleMenu />
    <CloudCopyDialog />
    <HotkeyDialog />
    <PublishDialog />
    <PairingDialog />

    <!-- Over the toolbar: module panels are native views drawn above this
         page, so anything lower would be hidden behind them. -->
    <div class="fixed top-2 left-1/2 z-[60] -translate-x-1/2" role="status" aria-live="polite">
      <p v-if="toast" class="bg-secondary rounded-lg border px-4 py-2 text-sm shadow-lg" data-testid="toast">{{ toast }}</p>
    </div>
  </div>
</template>
