<script setup lang="ts">
import { ChevronDown } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent } from "@tavora/official-ui/components/ui/collapsible";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { onMounted, reactive, watch } from "vue";
import { act, resource } from "../api";
import ActionButton from "../components/ActionButton.vue";
import Group from "../components/Group.vue";
import Line from "../components/Line.vue";
import PageTitle from "../components/PageTitle.vue";
import { bytes, date, plural, when } from "../format";
import { refreshTick, summary } from "../nav";
import type { Modules } from "../types";

const modules = resource<Modules>("/api/modules");
// Which modules show their versions.
const open = reactive(new Set<string>());
const toggle = (id: string) => (open.has(id) ? open.delete(id) : open.add(id));

async function setListed(id: string, listed: boolean): Promise<void> {
  await act("/api/catalog/listed", { id, listed });
  await Promise.all([modules.reload(), summary.reload()]);
}

onMounted(() => void modules.reload());
watch(refreshTick, () => void modules.reload());
</script>

<template>
  <PageTitle title="Modules" hint="Every module in the catalog, listed or not." />
  <Notice v-if="modules.error.value" variant="error">{{ modules.error.value }}</Notice>

  <template v-if="modules.data.value">
    <Notice v-if="modules.data.value.fullSince" variant="warning">The catalog has been full since {{ when(modules.data.value.fullSince) }}. Uploads are refused until there's room.</Notice>

    <Group title="Storage">
      <div class="flex flex-col gap-2 px-3 py-3">
        <p class="text-sm">{{ bytes(modules.data.value.storedBytes) }} of {{ bytes(modules.data.value.limitBytes) }} used</p>
        <Progress :model-value="Math.min(100, (modules.data.value.storedBytes / modules.data.value.limitBytes) * 100)" />
      </div>
    </Group>

    <Group :title="plural(modules.data.value.modules.length, 'module')">
      <EmptyState v-if="modules.data.value.modules.length === 0" class="m-3" title="No modules yet" description="Published modules show up here." />
      <Collapsible v-for="module in modules.data.value.modules" :key="module.id" :open="open.has(module.id)">
        <Line :title="module.name" :sub="`${module.id}${module.publisher ? ` · ${module.publisher}` : ''} · ${module.versions[0]?.version ?? '–'} · ${plural(module.installs, 'install')} · ${bytes(module.storedBytes)}`">
          <template #badges><Badge :variant="module.listed ? 'success' : 'warning'">{{ module.listed ? "Listed" : "Unlisted" }}</Badge></template>
          <template #actions>
            <Button type="button" variant="ghost" size="sm" :aria-expanded="open.has(module.id)" @click="toggle(module.id)">{{ plural(module.versions.length, "version") }}<ChevronDown :class="{ 'rotate-180': open.has(module.id) }" /></Button>
            <ActionButton
              v-if="module.listed"
              variant="danger"
              :run="() => setListed(module.id, false)"
              :ask="{ title: `Unlist ${module.name}?`, description: 'It leaves Browse. Copies players already installed keep working.', confirm: 'Unlist' }"
              >Unlist</ActionButton
            >
            <ActionButton v-else variant="secondary" :run="() => setListed(module.id, true)">List</ActionButton>
          </template>
        </Line>
        <CollapsibleContent>
          <div class="bg-background/40 border-t px-3 py-2">
            <p v-for="version in module.versions" :key="version.version" class="text-muted-foreground flex gap-3 py-0.5 text-xs">
              <span class="text-foreground w-20 font-medium">{{ version.version }}</span>
              <span class="flex-1">{{ date(version.publishedAt) }}</span>
              <span>{{ bytes(version.size) }}</span>
              <span class="w-20 text-right">{{ version.zipKept ? "zip kept" : "zip removed" }}</span>
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Group>
  </template>
  <p v-else class="text-muted-foreground text-sm">Loading…</p>
</template>
