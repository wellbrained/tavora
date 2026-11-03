<script setup lang="ts">
import { TooltipProvider } from "reka-ui";
import AddGameDialog from "./components/AddGameDialog.vue";
import AddPersonalDialog from "./components/AddPersonalDialog.vue";
import AddModuleDialog from "./components/AddModuleDialog.vue";
import CloudCopyDialog from "./components/CloudCopyDialog.vue";
import ProfileDialog from "./components/profile/ProfileDialog.vue";
import RecoveryAskDialog from "./components/settings/RecoveryAskDialog.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import GrantDialog from "./components/GrantDialog.vue";
import HotkeyDialog from "./components/HotkeyDialog.vue";
import LinkChoiceDialog from "./components/LinkChoiceDialog.vue";
import NavigationChoiceDialog from "./components/NavigationChoiceDialog.vue";
import WorkspaceRail from "./components/WorkspaceRail.vue";
import GameSwitchDialog from "./components/GameSwitchDialog.vue";
import ModuleMenu from "./components/menus/ModuleMenu.vue";
import PanelDialog from "./components/PanelDialog.vue";
import PromptDialog from "./components/PromptDialog.vue";
import SearchDialog from "./components/SearchDialog.vue";
import ShareIconsDialog from "./components/ShareIconsDialog.vue";
import SettingsDialog from "./components/settings/SettingsDialog.vue";
import InboxDialogs from "./components/messages/InboxDialogs.vue";
import { computed, defineAsyncComponent, onMounted } from "vue";
import { api, dialog, pairing, publish, settingsOpen, state, trialWelcome } from "./host";
import { Toaster } from "@tavora/official-ui/components/ui/toast";
import { bridgeToasts, toastsFallback } from "./toast-bridge";
import OverlayPage from "./pages/OverlayPage.vue";
import WorkspacePage from "./pages/WorkspacePage.vue";
import OnboardingPage from "./pages/OnboardingPage.vue";
import WelcomePage from "./pages/WelcomePage.vue";
import { everWanted } from "./lib/ever-wanted";
import { findInstalledGames } from "./lib/installed-games";

// Dialogs most people never open load the first time they are wanted, not with the window.
const PairingDialog = defineAsyncComponent(() => import("./components/PairingDialog.vue"));
const CopyExampleDialog = defineAsyncComponent(() => import("./components/developer/CopyExampleDialog.vue"));
const DeveloperStartDialog = defineAsyncComponent(() => import("./components/developer/DeveloperStartDialog.vue"));
const OfficialPublishDialog = defineAsyncComponent(() => import("./components/developer/OfficialPublishDialog.vue"));
const PublishDialog = defineAsyncComponent(() => import("./components/developer/PublishDialog.vue"));
const SteamImportDialog = defineAsyncComponent(() => import("./components/SteamImportDialog.vue"));
// These three are always in the page; they are drawn from the first time they have something to show.
const publishWanted = everWanted(publish);
const officialPublishWanted = everWanted(() => state.value?.officialPublish?.run);
const pairingWanted = everWanted(() => pairing.value?.approve);

// Finding the games on this PC takes a while the first time, so it starts quietly a few seconds after launch
// (once the app has drawn and loaded what it needs) and the Add a game dialog finds the list ready.
const FIRST_SEARCH_DELAY_MS = 4000;
onMounted(() => setTimeout(() => void findInstalledGames(), FIRST_SEARCH_DELAY_MS));

// Tavora's own toasts are drawn by a page above the panels, where the user put them (main/toast-view.ts).
bridgeToasts(api.toasts);
// Only if that page is down for good (main/toast-view.ts): then this page draws them, as it did before. Module panels are native
// views above this page, so at the top, over the toolbar, is where they stay in sight; while Settings covers the panels, where the user put them.
const fallbackPosition = computed(() => (settingsOpen.value && state.value ? state.value.library.toasts : "top-center"));
</script>

<template>
  <div v-if="state" class="flex h-full">
    <TooltipProvider :delay-duration="150" :skip-delay-duration="500">
      <WorkspaceRail />
    </TooltipProvider>
    <div class="relative h-full min-w-0 flex-1">
      <WorkspacePage v-if="state.screen === 'workspace' && state.currentWorkspaceId" :key="state.currentWorkspaceId" />
      <OverlayPage v-else-if="state.screen === 'overlay'" />
      <template v-else>
        <OnboardingPage v-if="trialWelcome" dry />
        <OnboardingPage v-else-if="!state.library.onboarded" />
        <WelcomePage v-else />
        <!-- Lets the window be moved from the empty top edge of Home. -->
        <div class="app-drag absolute inset-x-0 top-0 h-12" aria-hidden="true" />
      </template>
    </div>

    <SettingsDialog />
    <!-- After Settings, so the account opened from a Settings page comes on top of it. -->
    <ProfileDialog />
    <SearchDialog />
    <AddGameDialog v-if="dialog?.kind === 'add-game'" />
    <AddPersonalDialog v-if="dialog?.kind === 'add-personal'" />
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
    <PanelDialog />
    <CloudCopyDialog />
    <HotkeyDialog />
    <PublishDialog v-if="publishWanted" />
    <OfficialPublishDialog v-if="officialPublishWanted" />
    <PairingDialog v-if="pairingWanted" />

    <Toaster v-if="toastsFallback" :position="fallbackPosition" :class="settingsOpen ? 'z-[60]!' : 'top-1! z-[60]!'" />
  </div>
</template>
