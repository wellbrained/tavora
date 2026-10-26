<script setup lang="ts">
import { ChevronDown } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent } from "@tavora/official-ui/components/ui/collapsible";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { act, download, message, resource } from "../api";
import ActionButton from "../components/ActionButton.vue";
import BlockDialog from "../components/BlockDialog.vue";
import Group from "../components/Group.vue";
import Line from "../components/Line.vue";
import PageTitle from "../components/PageTitle.vue";
import { bytes, date, plural, when } from "../format";
import { refreshTick, summary } from "../nav";
import { problem } from "../problem";
import type { Blocks, Modules } from "../types";

const modules = resource<Modules>("/api/modules");
// Which modules show their versions.
const open = reactive(new Set<string>());
const toggle = (id: string) => (open.has(id) ? open.delete(id) : open.add(id));

const blocks = resource<Blocks>("/api/blocks");
const toSign = computed(() => blocks.data.value?.blocks.filter((block) => block.state === "to-sign").length ?? 0);
/** in-force or to-sign, for a zip that has a block. */
const blockOf = (sha256: string) => blocks.data.value?.blocks.find((block) => block.sha256 === sha256)?.state;

const load = () => Promise.all([modules.reload(), blocks.reload(), summary.reload()]);

async function setListed(id: string, listed: boolean): Promise<void> {
  await act("/api/catalog/listed", { id, listed });
  await load();
}

// Block asks why first; the reason is what players read.
const blocking = ref<{ name: string; version: string; sha256: string } | null>(null);
async function block(reason: string): Promise<void> {
  const target = blocking.value;
  blocking.value = null;
  if (!target) return;
  try {
    await act("/api/blocks", { sha256: target.sha256, reason });
    problem.value = "";
  } catch (failure) {
    problem.value = message(failure);
  }
  await load();
}

onMounted(() => void load());
watch(refreshTick, () => void load());
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

    <Group v-if="blocks.data.value?.blocks.length" title="Blocks" hint="A blocked zip turns off for every player once the signed list holds it. Their data stays.">
      <template #actions>
        <ActionButton variant="secondary" :run="() => download('/api/blocks/blocks.json', 'blocks.json')">blocks.json</ActionButton>
      </template>
      <p v-if="toSign" class="text-muted-foreground px-3 py-2 text-xs">
        The file holds every block in force plus the ones to sign. Sign it offline with
        <code>pnpm tavora-catalog-sign blocks &lt;file&gt; --key &lt;catalogue key&gt; --out &lt;signed file&gt;</code>, then upload with <code>tavora-api-catalog set-list blocks</code>. To take a block back, sign a list without it.
      </p>
      <Line v-for="entry in blocks.data.value.blocks" :key="entry.sha256" :title="entry.name ? `${entry.name} ${entry.version}` : entry.sha256" :sub="entry.reason">
        <template #badges><Badge :variant="entry.state === 'in-force' ? 'destructive' : 'warning'">{{ entry.state === "in-force" ? "in force" : "to sign" }}</Badge></template>
        <template #actions>
          <ActionButton v-if="entry.state === 'to-sign'" variant="secondary" :run="async () => { await act('/api/blocks/remove', { sha256: entry.sha256 }); await load(); }">Take back</ActionButton>
        </template>
      </Line>
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
              <span class="w-16 text-right">
                <Badge v-if="blockOf(version.sha256)" variant="destructive">{{ blockOf(version.sha256) === "in-force" ? "blocked" : "to sign" }}</Badge>
                <Button v-else type="button" variant="ghost" size="xs" class="text-destructive" @click="blocking = { name: module.name, version: version.version, sha256: version.sha256 }">Block</Button>
              </span>
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Group>
  </template>
  <p v-else class="text-muted-foreground text-sm">Loading…</p>

  <BlockDialog v-if="blocking" :name="blocking.name" :version="blocking.version" @confirm="block" @cancel="blocking = null" />
</template>
