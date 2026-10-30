<script setup lang="ts">
import { AlertTriangle, Blocks, FolderOpen, Download, CheckCircle2, Info, LayoutGrid, Link2, Loader2, MoreHorizontal, Plus, StickyNote, Store, XCircle } from "@lucide/vue";
import { SegmentedControl, Tooltip } from "@tavora/official-ui";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import { Expandable } from "@tavora/official-ui/components/ui/expandable";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { ActionList, type ActionEntry } from "@tavora/official-ui/components/ui/action-list";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { Sparkline } from "@tavora/official-ui/components/ui/sparkline";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@tavora/official-ui/components/ui/table";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger, TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";
import DemoSection from "../DemoSection.vue";
import ModuleSettingsDemo from "./ModuleSettingsDemo.vue";
import Specimen from "../Specimen.vue";
import { type SectionId, sectionTitle as title } from "../sections";

defineProps<{ visible: Set<SectionId>; off: boolean }>();

const started = ref("");
const startActions: ActionEntry[] = [
  { id: "import", label: "Import a build", description: "Start from a file on your PC.", icon: FolderOpen, testid: "start-import" },
  { id: "export", label: "Browse shared builds", description: "Find one other players made.", icon: Download },
  { id: "later", label: "Not yet available", description: "Comes with a later update.", icon: StickyNote, disabled: true },
];
const stripTabs = ref<StripTab[]>(["Iron", "Copper", "Steel", "Plastic"].map((label) => ({ id: label.toLowerCase(), label, closable: true, renamable: true })));
const stripActive = ref("iron");
const crowdTabs = ref<StripTab[]>(Array.from({ length: 12 }, (_, i) => ({ id: `plan-${i + 1}`, label: `Production plan ${i + 1}`, closable: true })));
const crowdActive = ref("plan-1");
let stripCount = 0;
function closeStripTab(id: string) {
  if (stripTabs.value.length > 1) stripTabs.value = stripTabs.value.filter((tab) => tab.id !== id);
}
function reorderStrip(order: string[]) {
  stripTabs.value = order.map((id) => stripTabs.value.find((tab) => tab.id === id)!);
}
function renameStripTab(id: string, label: string) {
  stripTabs.value = stripTabs.value.map((tab) => (tab.id === id ? { ...tab, label } : tab));
}
function addStripTab() {
  stripCount += 1;
  const tab = { id: `new-${stripCount}`, label: `New plan ${stripCount}`, closable: true, renamable: true };
  stripTabs.value = [...stripTabs.value, tab];
  stripActive.value = tab.id;
}
const iconTabs = ref<StripTab[]>([{ id: "iron", label: "Iron", closable: true, renamable: true }, { id: "copper", label: "Copper", renamable: true }]);
const iconActive = ref("iron");
const feeds = (id: string) => (id === "iron" ? ["Copper"] : []);
const linkTip = ref<{ open: boolean; anchor: { left: number; top: number; right: number; bottom: number } }>({ open: false, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
function showLinkTip(e: Event) {
  const { left, top, right, bottom } = (e.currentTarget as HTMLElement).getBoundingClientRect();
  linkTip.value = { open: true, anchor: { left, top, right, bottom } };
}
const hideLinkTip = () => (linkTip.value.open = false);
const progress = ref(45);
const spark = Array.from({ length: 60 }, (_, i) => Math.round(50 + 30 * Math.sin(i / 5) + 12 * Math.sin(i * 1.7)));
const switchOn = ref(true);
const density = ref<"tight" | "normal">("normal");
const selectedRow = ref("b");
const navSelected = ref("all");
const NAV_GROUPS: NavGroup[] = [
  { heading: "Installed", items: [{ id: "all", label: "All", icon: Blocks, badge: 12 }, { id: "workspace", label: "In this workspace", icon: LayoutGrid, badge: 3 }] },
  { heading: "More", items: [{ id: "catalog", label: "Catalog", icon: Store }, { id: "featured", label: "Featured", level: 1 }, { id: "recent", label: "Recent", level: 2 }] },
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

<DemoSection v-if="visible.has('progress')" id="progress" :title="title('progress')" description="Show progress the user started. Nothing loops on its own.">
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
        <Specimen label="Sparkline" column>
          <Sparkline :values="spark" class="max-w-64" label="Usage over the last minute" />
          <Sparkline :values="spark" color="success" :height="24" class="max-w-64" label="Usage, short and green" />
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
          <Notice>Notes are shared by every panel of this module in the current workspace.</Notice>
          <Notice variant="success">Imported 24 to-dos.</Notice>
          <Notice variant="warning" title="Almost full">This note is almost at its size limit.</Notice>
          <Notice variant="error">
            Could not save. Your change is kept and will be tried again.
            <template #action><Button size="xs" variant="secondary" :disabled="off">Retry</Button></template>
          </Notice>
        </div>
      </DemoSection>

<DemoSection v-if="visible.has('empty')" id="empty" :title="title('empty')" description="A short title, one line and one action. Use it where a list has nothing in it yet.">
        <EmptyState title="No notes yet" description="Notes you write in this workspace show up here.">
          <template #icon><StickyNote :stroke-width="1.5" /></template>
          <template #action><Button :disabled="off"><Plus :stroke-width="1.5" /> New note</Button></template>
        </EmptyState>
        <Specimen label="With a list of actions (ActionList)" column>
          <EmptyState title="No build yet" description="Start in one of these ways.">
            <template #icon><StickyNote :stroke-width="1.5" /></template>
            <template #action><ActionList :entries="startActions" @select="started = $event" /></template>
          </EmptyState>
          <p class="text-muted-foreground text-xs" data-testid="action-list-picked">Picked: {{ started || "nothing yet" }}</p>
        </Specimen>
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

<DemoSection v-if="visible.has('collapsible')" id="collapsible" :title="title('collapsible')" description="A heading that opens and closes the part below it. Use it for notes and details people don't always need.">
        <Specimen label="Closed and open" column>
          <Collapsible class="w-full max-w-md rounded-md border px-3 py-2">
            <CollapsibleTrigger class="py-1" :disabled="off">Notes</CollapsibleTrigger>
            <CollapsibleContent class="text-muted-foreground pt-2 pb-1 text-sm">Swap the second gem once you reach level 40.</CollapsibleContent>
          </Collapsible>
          <Collapsible default-open class="w-full max-w-md rounded-md border px-3 py-2">
            <CollapsibleTrigger class="py-1" :disabled="off">Skill tree info</CollapsibleTrigger>
            <CollapsibleContent class="text-muted-foreground pt-2 pb-1 text-sm">118 points spent, 12 in the Deadeye ascendancy.</CollapsibleContent>
          </Collapsible>
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
        <Specimen label="Tabs you can close, drag and rename (TabStrip)" column>
          <TabStrip v-model="stripActive" :tabs="stripTabs" aria-label="Plans" data-testid="tab-strip" @close="closeStripTab" @reorder="reorderStrip" @rename="renameStripTab">
            <template #add>
              <Button variant="ghost" size="icon-sm" aria-label="New tab" data-testid="strip-add" :disabled="off" @click="addStripTab"><Plus :stroke-width="1.5" /></Button>
            </template>
          </TabStrip>
          <p class="text-muted-foreground text-xs">Drag to reorder (or Alt + ← / →), middle-click or Delete to close, double-click or F2 to rename. The last one can't be closed.</p>
          <p class="text-muted-foreground text-xs" data-testid="strip-state">{{ stripTabs.map((tab) => tab.label).join(", ") }} · open: {{ stripTabs.find((tab) => tab.id === stripActive)?.label ?? "none" }}</p>
        </Specimen>
        <Specimen label="A tab with an icon before its name (TabStrip, icon slot)" column>
          <TabStrip v-model="iconActive" :tabs="iconTabs" aria-label="Linked plans" data-testid="tab-strip-icon" @rename="(id, label) => (iconTabs = iconTabs.map((tab) => (tab.id === id ? { ...tab, label } : tab)))">
            <template #icon="{ tab }">
              <Link2
                v-if="feeds(tab.id).length"
                class="text-primary size-3.5 flex-none"
                :stroke-width="1.5"
                tabindex="0"
                :aria-label="`Feeds ${feeds(tab.id).join(', ')}`"
                data-testid="plan-tab-feeds"
                @pointerenter="showLinkTip"
                @pointerleave="hideLinkTip"
                @focus="showLinkTip"
                @blur="hideLinkTip"
              />
            </template>
          </TabStrip>
          <Tooltip :open="linkTip.open" :anchor="linkTip.anchor" compact title="Feeds Copper" @dismiss="hideLinkTip" />
          <p class="text-muted-foreground text-xs">The icon stays while you rename the tab.</p>
        </Specimen>
        <Specimen label="Too many for the width: the wheel scrolls, the edges fade" column>
          <TabStrip v-model="crowdActive" :tabs="crowdTabs" class="w-72" aria-label="Many tabs" data-testid="tab-strip-crowd" @close="(id) => (crowdTabs = crowdTabs.filter((tab) => tab.id !== id))" />
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('table')" id="table" :title="title('table')" description="Rows of facts that share columns. Put numbers in a right-aligned column. A table wider than its panel scrolls sideways.">
        <Specimen label="Plain, with a selected row and a caption" column>
          <Table class="max-w-md">
            <TableCaption>Ingredients for 10 portions</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Where</TableHead>
                <TableHead class="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Flour</TableCell>
                <TableCell class="text-muted-foreground">Oven</TableCell>
                <TableCell class="text-right tabular-nums">10</TableCell>
              </TableRow>
              <TableRow data-state="selected">
                <TableCell>Mushrooms</TableCell>
                <TableCell class="text-muted-foreground">Forest</TableCell>
                <TableCell class="text-right tabular-nums">10</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Salt</TableCell>
                <TableCell class="text-muted-foreground">Shop</TableCell>
                <TableCell class="text-right tabular-nums">4</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Specimen>
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

<DemoSection v-if="visible.has('settings')" id="settings" :title="title('settings')" description="A module's settings in its dialog: pages left, one column right, controls lined up in one column. Changes apply at once.">
        <Specimen label="Dialog (960 × 680 in the app)" column>
          <div class="overflow-x-auto"><ModuleSettingsDemo :off="off" /></div>
        </Specimen>
      </DemoSection>
</template>
