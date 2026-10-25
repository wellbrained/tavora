<script setup lang="ts">
import { AlertTriangle, Blocks, CheckCircle2, Gamepad2, Info, Loader2, MoreHorizontal, Plus, StickyNote, Store, XCircle } from "@lucide/vue";
import { SegmentedControl } from "@tavora/official-ui";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Expandable } from "@tavora/official-ui/components/ui/expandable";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";
import DemoSection from "../DemoSection.vue";
import Specimen from "../Specimen.vue";
import { type SectionId, sectionTitle as title } from "../sections";

defineProps<{ visible: Set<SectionId>; off: boolean }>();

const progress = ref(45);
const switchOn = ref(true);
const density = ref<"tight" | "normal">("normal");
const selectedRow = ref("b");
const navSelected = ref("all");
const NAV_GROUPS: NavGroup[] = [
  { heading: "Installed", items: [{ id: "all", label: "All", icon: Blocks, badge: 12 }, { id: "game", label: "In this game", icon: Gamepad2, badge: 3 }] },
  { heading: "More", items: [{ id: "catalog", label: "Catalog", icon: Store }] },
];
function bump(by: number) {
  progress.value = Math.min(100, Math.max(0, progress.value + by));
}
</script>

<template>
<DemoSection v-if="visible.has('status')" id="status" :title="title('status')" description="State is never shown by colour alone: a dot always comes with a word.">
        <Specimen label="Badges">
          <Badge>New</Badge>
          <Badge variant="secondary">Official</Badge>
          <Badge variant="outline">Local</Badge>
          <Badge variant="success"><CheckCircle2 :stroke-width="2" /> Saved</Badge>
          <Badge variant="warning"><AlertTriangle :stroke-width="2" /> Low space</Badge>
          <Badge variant="info"><Info :stroke-width="2" /> Beta</Badge>
          <Badge variant="destructive"><XCircle :stroke-width="2" /> Failed</Badge>
        </Specimen>
        <Specimen label="Status dot and word" column>
          <span class="flex items-center gap-2 text-sm"><span class="bg-success size-2 rounded-full" /> Running</span>
          <span class="flex items-center gap-2 text-sm"><span class="bg-info size-2 rounded-full" /> Not responding</span>
          <span class="flex items-center gap-2 text-sm"><span class="bg-destructive size-2 rounded-full" /> Could not load</span>
          <span class="flex items-center gap-2 text-sm"><span class="bg-muted-foreground size-2 rounded-full" /> Loading</span>
        </Specimen>
        <Specimen label="Keyboard keys">
          <span class="text-sm">Search with</span>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('progress')" id="progress" :title="title('progress')" description="Show progress the player started. Nothing loops on its own.">
        <Specimen label="Progress bar" column>
          <div class="flex items-center gap-3">
            <Progress :model-value="progress" class="max-w-64" aria-label="Import progress" />
            <span class="text-muted-foreground text-xs tabular-nums">{{ progress }}%</span>
          </div>
          <div class="flex gap-2">
            <Button size="xs" variant="secondary" :disabled="off" @click="bump(-15)">Less</Button>
            <Button size="xs" variant="secondary" :disabled="off" @click="bump(15)">More</Button>
          </div>
        </Specimen>
        <Specimen label="Spinner">
          <Loader2 class="text-muted-foreground size-4 animate-spin" :stroke-width="1.5" />
          <span class="text-muted-foreground text-sm">Loading notes…</span>
        </Specimen>
        <Specimen label="Placeholder rows" column>
          <div v-for="width in ['w-3/4', 'w-1/2', 'w-2/3']" :key="width" class="flex items-center gap-3">
            <span class="bg-muted size-5 flex-none rounded-full" />
            <span :class="['bg-muted h-3 rounded-sm', width]" />
          </div>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('notices')" id="notices" :title="title('notices')" description="Inline notices inside a module. An icon and a sentence; colour only tints. Errors are announced at once.">
        <div class="flex flex-col gap-2">
          <Notice>Notes are shared by every panel of this module in the current game.</Notice>
          <Notice variant="success">Imported 24 to-dos.</Notice>
          <Notice variant="warning" title="Almost full">This note is almost at its size limit.</Notice>
          <Notice variant="error">
            Could not save. Your change is kept and will be tried again.
            <template #action><Button size="xs" variant="secondary" :disabled="off">Retry</Button></template>
          </Notice>
        </div>
      </DemoSection>

<DemoSection v-if="visible.has('empty')" id="empty" :title="title('empty')" description="A short title, one line and one action. Use it where a list has nothing in it yet.">
        <EmptyState title="No notes yet" description="Notes you write for this game show up here.">
          <template #icon><StickyNote :stroke-width="1.5" /></template>
          <template #action><Button :disabled="off"><Plus :stroke-width="1.5" /> New note</Button></template>
        </EmptyState>
      </DemoSection>

<DemoSection v-if="visible.has('expandable')" id="expandable" :title="title('expandable')" description="Long text cut to a set height, with Show more below. Short text shows in full.">
        <Specimen label="Long text" column>
          <Expandable :max-height="72" class="max-w-md">
            <div class="space-y-2 text-sm leading-relaxed">
              <p>Plan your skill tree, save as many builds as you like and share them as files.</p>
              <p>Track the bosses you've beaten in each of your worlds, with spoilers hidden until you want them.</p>
              <p>Everything stays on your PC and works offline.</p>
            </div>
          </Expandable>
        </Specimen>
        <Specimen label="Short text" column>
          <Expandable :max-height="72" class="max-w-md">
            <p class="text-sm">A quick calculator that keeps your last results.</p>
          </Expandable>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('tabs')" id="tabs" :title="title('tabs')" description="Switch between views of the same thing. The selected tab carries an accent line, like panel tabs.">
        <Tabs default-value="overview">
          <TabsList>
            <TabsTrigger value="overview" :disabled="off">Overview</TabsTrigger>
            <TabsTrigger value="skills" :disabled="off">Skills</TabsTrigger>
            <TabsTrigger value="gear" :disabled="off">Gear</TabsTrigger>
            <TabsTrigger value="locked" disabled>Locked</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" class="text-muted-foreground text-sm">The build at a glance.</TabsContent>
          <TabsContent value="skills" class="text-muted-foreground text-sm">Skill gems and supports.</TabsContent>
          <TabsContent value="gear" class="text-muted-foreground text-sm">What to wear, slot by slot.</TabsContent>
        </Tabs>
      </DemoSection>

<DemoSection v-if="visible.has('lists')" id="lists" :title="title('lists')" description="Rows highlight on hover with the accent surface, never a glow.">
        <Specimen label="Selectable list" column>
          <ul role="listbox" aria-label="Notes" class="flex flex-col">
            <li
              v-for="row in [
                { id: 'a', title: 'Boss checklist', meta: '2 h ago' },
                { id: 'b', title: 'Atlas strategy', meta: 'Yesterday' },
                { id: 'c', title: 'Trade notes', meta: 'Oct 9' },
              ]"
              :key="row.id"
              role="option"
              :aria-selected="selectedRow === row.id"
              tabindex="0"
              :class="[
                'group flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none',
                selectedRow === row.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              ]"
              @click="selectedRow = row.id"
              @keydown.enter="selectedRow = row.id"
            >
              <span class="min-w-0 flex-1 truncate">{{ row.title }}</span>
              <span class="text-muted-foreground text-xs">{{ row.meta }}</span>
              <Button size="icon-xs" variant="ghost" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="More" title="More" @click.stop>
                <MoreHorizontal :stroke-width="1.5" />
              </Button>
            </li>
          </ul>
        </Specimen>
        <Specimen label="Setting rows" column>
          <div class="flex flex-col">
            <div class="flex items-center gap-6 py-3">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-sm font-medium">Show finished</span>
                <span class="text-muted-foreground text-xs">Keep done to-dos in the list.</span>
              </div>
              <Switch v-model="switchOn" aria-label="Show finished" :disabled="off" />
            </div>
            <Separator />
            <div class="flex items-center gap-6 py-3">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-sm font-medium">Density</span>
                <span class="text-muted-foreground text-xs">How much space rows take.</span>
              </div>
              <SegmentedControl
                v-model="density"
                label="Density"
                :disabled="off"
                :options="[
                  { value: 'tight', label: 'Tight' },
                  { value: 'normal', label: 'Normal' },
                ]"
              />
            </div>
          </div>
        </Specimen>
        <Specimen label="Card" column>
          <div class="bg-card text-card-foreground flex flex-col gap-2 rounded-lg border p-4">
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-semibold">Lightning Arrow Deadeye</span>
              <Badge variant="secondary">League start</Badge>
            </div>
            <p class="text-muted-foreground text-sm">Fast clear, cheap to start, scales well into the atlas.</p>
          </div>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('navlist')" id="navlist" :title="title('navlist')" description="The list of categories beside a page, like in Settings. Arrow keys, Home and End move through it.">
        <Specimen label="Grouped, with counts" column>
          <NavList v-model="navSelected" class="w-56" label="Categories" :groups="NAV_GROUPS" />
        </Specimen>
      </DemoSection>
</template>
