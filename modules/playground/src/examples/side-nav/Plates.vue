<script setup lang="ts">
import { Blocks, LayoutGrid, Store } from "@lucide/vue";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { ref } from "vue";

const selected = ref("all");
/** Each group sets --tone, its colour. */
const PLATE_GROUPS: NavGroup[] = [
  { heading: "Installed", icon: Blocks, class: "[--tone:var(--primary)]", items: [{ id: "all", label: "All", icon: Blocks, badge: 12 }, { id: "workspace", label: "In this workspace", icon: LayoutGrid, badge: 3 }] },
  { heading: "More", icon: Store, class: "[--tone:var(--info)]", items: [{ id: "catalog", label: "Catalog", icon: Store }, { id: "featured", label: "Featured", level: 1 }, { id: "recent", label: "Recent", level: 2 }] },
];
</script>

<template>
  <NavList
    v-model="selected"
    class="w-56 gap-2.5"
    label="Categories"
    :groups="PLATE_GROUPS"
    group-class="rounded-xl border border-[color-mix(in_srgb,var(--tone)_18%,transparent)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--tone)_13%,transparent),color-mix(in_srgb,var(--tone)_3%,transparent)_70%)] p-1 [&_[aria-current=page]]:bg-[color-mix(in_srgb,var(--tone)_22%,transparent)]"
    heading-class="pt-1 text-[color-mix(in_srgb,var(--tone)_80%,var(--foreground))]"
  />
</template>
