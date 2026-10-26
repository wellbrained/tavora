<script setup lang="ts">
// Tavora Admin: a left list of sections and one column of content. Everything behind the admin token.
import { Activity, BarChart3, Boxes, ClipboardCheck, Home, LogOut, Newspaper, RefreshCw, ShieldCheck, Users } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { computed, onMounted, ref, watch, type Component } from "vue";
import emblem from "./brand/tavora-emblem.png";
import { detectProxy, lock, setToken, token } from "./api";
import { go, refreshTick, section, summary, type SectionId } from "./nav";
import { problem } from "./problem";
import ApprovalSection from "./sections/ApprovalSection.vue";
import AccountsSection from "./sections/AccountsSection.vue";
import ModulesSection from "./sections/ModulesSection.vue";
import OverviewSection from "./sections/OverviewSection.vue";
import ReviewSection from "./sections/ReviewSection.vue";
import StatsSection from "./sections/StatsSection.vue";
import StatusSection from "./sections/StatusSection.vue";
import UpdatesSection from "./sections/UpdatesSection.vue";

// Add a section here and in nav.ts.
const SECTIONS: { id: SectionId; label: string; icon: Component; view: Component; waiting?: string }[] = [
  { id: "overview", label: "Overview", icon: Home, view: OverviewSection },
  { id: "approval", label: "Module Review", icon: ShieldCheck, view: ApprovalSection, waiting: "approval" },
  { id: "updates", label: "Tavora Updates", icon: Newspaper, view: UpdatesSection },
  { id: "modules", label: "Modules", icon: Boxes, view: ModulesSection },
  { id: "review", label: "Icon Review", icon: ClipboardCheck, view: ReviewSection, waiting: "review" },
  { id: "accounts", label: "Accounts", icon: Users, view: AccountsSection },
  { id: "stats", label: "Stats", icon: BarChart3, view: StatsSection },
  { id: "status", label: "Status", icon: Activity, view: StatusSection, waiting: "status" },
];

const typed = ref("");
/** Until we know whether a proxy signs in for us, show nothing rather than the token form. */
const checking = ref(!token.value);
const wrong = ref(false);

/** How many things wait in a section, from the Overview's list of kinds. */
const waitingIn = (id: string) => (summary.data.value?.waiting ?? []).filter((kind) => kind.section === id).reduce((sum, kind) => sum + kind.count, 0);

const groups = computed<NavGroup[]>(() => [
  {
    items: SECTIONS.map((entry) => {
      const count = entry.waiting ? waitingIn(entry.waiting) : 0;
      return { id: entry.id, label: entry.label, icon: entry.icon, ...(count > 0 ? { badge: count, badgeAccent: true } : {}) };
    }),
  },
]);
const view = computed(() => SECTIONS.find((entry) => entry.id === section.value)?.view ?? OverviewSection);

function signIn(): void {
  if (typed.value.trim().length === 0) return;
  setToken(typed.value.trim());
  typed.value = "";
  wrong.value = false;
}

function refresh(): void {
  void summary.reload();
  refreshTick.value++;
}

// A refused token ends up here: the saved one was cleared, so the sign-in shows again.
watch(token, (value, before) => {
  if (value) void summary.reload();
  else if (before) wrong.value = true;
});
onMounted(async () => {
  // A proxy found here sets the token, and the watch above loads the summary.
  if (token.value) void summary.reload();
  else await detectProxy();
  checking.value = false;
});
</script>

<template>
  <div v-if="checking" class="h-full" />
  <div v-else-if="!token" class="flex h-full items-center justify-center p-6">
    <form class="flex w-full max-w-sm flex-col gap-3" @submit.prevent="signIn">
      <h1 class="flex items-center gap-2.5 text-xl font-semibold"><img :src="emblem" alt="" class="size-9" />Tavora Admin</h1>
      <p class="text-muted-foreground text-sm">Paste the admin token. It stays in this tab only.</p>
      <Notice v-if="wrong" variant="error">That token didn't work.</Notice>
      <Input v-model="typed" type="password" placeholder="Admin token" aria-label="Admin token" autocomplete="off" autofocus />
      <Button type="submit" :disabled="typed.trim().length === 0">Open</Button>
    </form>
  </div>

  <div v-else class="flex h-full">
    <aside class="bg-rail flex w-56 flex-none flex-col gap-3 border-r p-3">
      <p class="flex items-center gap-2.5 px-2 pt-1 text-lg font-semibold"><img :src="emblem" alt="" class="size-9" />Tavora Admin</p>
      <NavList :groups="groups" label="Sections" :model-value="section" class="flex-1" @update:model-value="go($event)" />
      <div class="flex flex-col gap-1">
        <Button type="button" variant="ghost" class="justify-start text-base [&_svg]:size-5" :disabled="summary.loading.value" @click="refresh"><RefreshCw :class="{ 'animate-spin': summary.loading.value }" />Refresh</Button>
        <Button type="button" variant="ghost" class="justify-start text-base [&_svg]:size-5" @click="lock"><LogOut />Sign out</Button>
      </div>
    </aside>
    <main class="min-w-0 flex-1 overflow-y-auto">
      <div class="flex max-w-[1056px] flex-col gap-6 p-6">
        <Notice v-if="problem" variant="error">{{ problem }}</Notice>
        <Notice v-if="summary.error.value" variant="error">{{ summary.error.value }}</Notice>
        <component :is="view" :key="section" />
      </div>
    </main>
  </div>
</template>
