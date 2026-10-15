<script setup lang="ts">
// UI Playground: every control the official modules share, shown on its own
// so the look and feel can be tried out and compared. Nothing here is saved
// except this panel's filter and the "Show disabled" switch, which turns every
// control into its disabled state.
import {
  AlertTriangle,
  Bold,
  CheckCircle2,
  ChevronRight,
  Copy,
  Info,
  Italic,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
  XCircle,
} from "@lucide/vue";
import { ConfirmDialog, connectModule, SegmentedControl } from "@tavora/official-ui";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Slider } from "@tavora/official-ui/components/ui/slider";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { THEME_TOKENS, type TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import DemoSection from "./DemoSection.vue";
import Specimen from "./Specimen.vue";

interface PanelState {
  filter: string;
  disabled: boolean;
}

const SECTIONS = [
  { id: "colours", title: "Colours", keywords: "tokens theme palette swatches radius" },
  { id: "type", title: "Typography", keywords: "text fonts headings caption mono numbers link" },
  { id: "buttons", title: "Buttons", keywords: "primary secondary ghost outline destructive link icon loading" },
  { id: "fields", title: "Text fields", keywords: "input textarea search label hint error" },
  { id: "choices", title: "Choices", keywords: "checkbox switch radio segmented select dropdown slider" },
  { id: "tabs", title: "Tabs", keywords: "tabs views" },
  { id: "status", title: "Badges and status", keywords: "badge chip tag status dot kbd shortcut" },
  { id: "progress", title: "Progress and loading", keywords: "progress spinner skeleton loading" },
  { id: "menus", title: "Menus", keywords: "dropdown menu context submenu actions" },
  { id: "dialogs", title: "Dialogs", keywords: "dialog modal confirm delete" },
  { id: "lists", title: "Lists and rows", keywords: "list row hover selected settings divider" },
  { id: "notices", title: "Notices", keywords: "alert callout info warning error success" },
  { id: "empty", title: "Empty state", keywords: "empty nothing placeholder" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const sdk = shallowRef<TavoraSDK | null>(null);
const panel = ref<PanelState>({ filter: "", disabled: false });
const tokens = ref<Record<string, string>>({});
const cleanup: (() => void)[] = [];

// Specimen state, so every control can be played with.
const checked = ref(true);
const unchecked = ref(false);
const mixed = ref<boolean | "indeterminate">("indeterminate");
const switchOn = ref(true);
const switchOff = ref(false);
const radio = ref("normal");
const segment = ref<"day" | "week" | "month">("week");
const density = ref<"tight" | "normal">("normal");
const select = ref("poe2");
const volume = ref([60]);
const range = ref([20, 80]);
const progress = ref(45);
const text = ref("");
const search = ref("");
const notes = ref("");
const name = ref("Waystone");
const showRead = ref(true);
const sort = ref("recent");
const selectedRow = ref("b");
const confirming = ref(false);
const renaming = ref(false);

const query = computed(() => panel.value.filter.trim().toLowerCase());
const visible = computed(() => {
  const ids = new Set<SectionId>();
  for (const section of SECTIONS) {
    if (!query.value || `${section.title} ${section.keywords}`.toLowerCase().includes(query.value)) ids.add(section.id);
  }
  return ids;
});
const off = computed(() => panel.value.disabled);
const title = (id: SectionId) => SECTIONS.find((section) => section.id === id)!.title;

function readTokens() {
  const style = getComputedStyle(document.documentElement);
  tokens.value = Object.fromEntries([...THEME_TOKENS, "radius"].map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
}

onMounted(async () => {
  readTokens();
  // The page also works outside Tavora (for example opened from dist/ in a
  // browser); it then keeps the default theme.
  try {
    const connected = await connectModule();
    readTokens();
    cleanup.push(connected.ui.onThemeChange(() => requestAnimationFrame(readTokens)));
    const state = await connected.panel.getState<Partial<PanelState>>();
    panel.value = {
      filter: typeof state?.filter === "string" ? state.filter : "",
      disabled: state?.disabled === true,
    };
    sdk.value = connected;
  } catch {
    // Not inside Tavora.
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));

function setPanel(patch: Partial<PanelState>) {
  panel.value = { ...panel.value, ...patch };
  void sdk.value?.panel.setState({ filter: panel.value.filter, disabled: panel.value.disabled });
}

function bump(by: number) {
  progress.value = Math.min(100, Math.max(0, progress.value + by));
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="playground-app">
    <header class="flex h-10 flex-none items-center gap-2 border-b px-2">
      <div class="relative min-w-0 flex-1">
        <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" :stroke-width="1.5" />
        <input
          type="search"
          class="placeholder:text-muted-foreground h-7 w-full rounded-md bg-transparent pr-2 pl-8 text-sm outline-none"
          placeholder="Filter elements"
          aria-label="Filter elements"
          data-testid="filter"
          :value="panel.filter"
          @input="setPanel({ filter: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <Label class="text-muted-foreground flex-none px-1 text-xs font-normal">
        <Switch :model-value="panel.disabled" data-testid="disable-all" @update:model-value="setPanel({ disabled: $event })" />
        Show disabled
      </Label>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="!visible.size" class="text-muted-foreground px-4 py-10 text-center text-sm" data-testid="no-match">
        Nothing matches “{{ panel.filter }}”.
      </p>

      <!-- Colours -->
      <DemoSection v-if="visible.has('colours')" id="colours" :title="title('colours')" description="The theme tokens every module receives, with their current values.">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          <div v-for="name in THEME_TOKENS" :key="name" class="flex items-center gap-2 rounded-md border p-1.5">
            <span class="size-7 flex-none rounded-sm border" :style="{ background: `var(--${name})` }" />
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-mono text-xs">{{ name }}</span>
              <span class="text-muted-foreground truncate font-mono text-xs">{{ tokens[name] }}</span>
            </span>
          </div>
        </div>
        <Specimen label="Radius">
          <span class="bg-secondary size-10 rounded-sm" title="rounded-sm" />
          <span class="bg-secondary size-10 rounded-md" title="rounded-md" />
          <span class="bg-secondary size-10 rounded-lg" title="rounded-lg" />
          <span class="bg-secondary size-10 rounded-xl" title="rounded-xl" />
          <span class="text-muted-foreground font-mono text-xs">--radius: {{ tokens.radius }}</span>
        </Specimen>
      </DemoSection>

      <!-- Typography -->
      <DemoSection v-if="visible.has('type')" id="type" :title="title('type')" description="Inter for the interface, JetBrains Mono for code and ids. Nothing is smaller than 12 px.">
        <div class="flex flex-col gap-3">
          <div>
            <p class="text-3xl leading-[34px] font-semibold">Welcome back</p>
            <p class="text-muted-foreground text-xs">Display · 28 / 34 · 600</p>
          </div>
          <div>
            <p class="text-xl font-semibold">Page or dialog title</p>
            <p class="text-muted-foreground text-xs">Title · 20 / 26 · 600</p>
          </div>
          <div>
            <p class="text-lg font-semibold">Section heading</p>
            <p class="text-muted-foreground text-xs">Heading · 16 / 22 · 600</p>
          </div>
          <div>
            <p class="text-base">Body text for notes, lists and inputs. It should read comfortably at arm's length on a second monitor.</p>
            <p class="text-muted-foreground text-xs">Body · 14 / 20 · 400</p>
          </div>
          <div>
            <p class="text-sm font-medium">Compact text for menus, buttons and panel headers</p>
            <p class="text-muted-foreground text-xs">Compact · 13 / 18 · 500</p>
          </div>
          <div>
            <p class="text-muted-foreground text-xs">Caption for hints, timestamps and labels</p>
            <p class="text-muted-foreground text-xs">Caption · 12 / 16 · 400</p>
          </div>
        </div>
        <Specimen label="Mono, tabular numbers and links" column>
          <code class="bg-secondary w-fit rounded-sm px-1.5 py-0.5 font-mono text-sm">tavora.playground</code>
          <p class="text-sm tabular-nums">Timer 01:07:42 · 1,111 kills · 98.6%</p>
          <p class="text-sm">Read the <a href="#type" class="text-primary underline-offset-4 hover:underline">style guide</a> before adding colours.</p>
        </Specimen>
      </DemoSection>

      <!-- Buttons -->
      <DemoSection v-if="visible.has('buttons')" id="buttons" :title="title('buttons')" description="One primary button per view; secondary for everything else.">
        <Specimen label="Variants">
          <Button :disabled="off">Primary</Button>
          <Button variant="secondary" :disabled="off">Secondary</Button>
          <Button variant="outline" :disabled="off">Outline</Button>
          <Button variant="ghost" :disabled="off">Ghost</Button>
          <Button variant="destructive" :disabled="off">Delete for good</Button>
          <Button variant="secondary" class="text-destructive" :disabled="off">Danger</Button>
          <Button variant="link" :disabled="off">Link</Button>
        </Specimen>
        <Specimen label="Sizes">
          <Button size="xs" variant="secondary" :disabled="off">Extra small</Button>
          <Button size="sm" variant="secondary" :disabled="off">Small</Button>
          <Button variant="secondary" :disabled="off">Default</Button>
          <Button size="lg" variant="secondary" :disabled="off">Large</Button>
        </Specimen>
        <Specimen label="With icons">
          <Button :disabled="off"><Plus :stroke-width="1.5" /> Add to-do</Button>
          <Button variant="secondary" :disabled="off"><Copy :stroke-width="1.5" /> Copy link</Button>
          <Button variant="ghost" size="sm" :disabled="off">More <ChevronRight :stroke-width="1.5" /></Button>
          <Button variant="secondary" disabled><Loader2 class="animate-spin" :stroke-width="1.5" /> Saving…</Button>
        </Specimen>
        <Specimen label="Icon only (each has a label and a native tooltip)">
          <Button size="icon-xs" variant="ghost" aria-label="Pin" title="Pin" :disabled="off"><Pin :stroke-width="1.5" /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Edit" title="Edit" :disabled="off"><Pencil :stroke-width="1.5" /></Button>
          <Button size="icon" variant="secondary" aria-label="Settings" title="Settings" :disabled="off"><Settings :stroke-width="1.5" /></Button>
          <Button size="icon-lg" variant="outline" aria-label="Add" title="Add" :disabled="off"><Plus :stroke-width="1.5" /></Button>
        </Specimen>
        <Specimen label="Toggle buttons">
          <div class="bg-background inline-flex gap-0.5 rounded-lg border p-0.5">
            <Button size="icon-sm" variant="ghost" aria-label="Bold" title="Bold" :aria-pressed="true" class="bg-secondary" :disabled="off"><Bold :stroke-width="1.5" /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Italic" title="Italic" :aria-pressed="false" :disabled="off"><Italic :stroke-width="1.5" /></Button>
          </div>
        </Specimen>
      </DemoSection>

      <!-- Text fields -->
      <DemoSection v-if="visible.has('fields')" id="fields" :title="title('fields')" description="Errors show red text under the field, not only a red border.">
        <div class="flex flex-col gap-1.5">
          <Label for="pg-name">Name</Label>
          <Input id="pg-name" v-model="name" :disabled="off" />
          <p class="text-muted-foreground text-xs">Shown in the panel tab.</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="pg-empty">With a placeholder</Label>
          <Input id="pg-empty" v-model="text" placeholder="Add a to-do" :disabled="off" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="pg-error">With an error</Label>
          <Input id="pg-error" model-value="ab" aria-invalid="true" aria-describedby="pg-error-text" :disabled="off" />
          <p id="pg-error-text" class="text-destructive text-xs">Use at least three characters.</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="pg-search">Search</Label>
          <div class="relative">
            <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" />
            <Input id="pg-search" v-model="search" type="search" class="pr-9 pl-9" placeholder="Search notes" :disabled="off" />
            <Button
              v-if="search"
              size="icon-xs"
              variant="ghost"
              class="absolute top-1/2 right-2 -translate-y-1/2"
              aria-label="Clear search"
              title="Clear search"
              @click="search = ''"
            >
              <X :stroke-width="1.5" />
            </Button>
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="pg-mono">Monospace</Label>
          <Input id="pg-mono" model-value="tavora.notes" class="font-mono" :disabled="off" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="pg-notes">Text area (grows with its text)</Label>
          <Textarea id="pg-notes" v-model="notes" placeholder="Details, links, anything else" :disabled="off" />
        </div>
      </DemoSection>

      <!-- Choices -->
      <DemoSection v-if="visible.has('choices')" id="choices" :title="title('choices')" description="Checkboxes for independent options, radios and segments for one of a few, a select for one of many.">
        <Specimen label="Checkbox" column>
          <Label><Checkbox v-model="checked" :disabled="off" /> Checked</Label>
          <Label><Checkbox v-model="unchecked" :disabled="off" /> Unchecked</Label>
          <Label><Checkbox v-model="mixed" :disabled="off" /> Some of them</Label>
        </Specimen>
        <Specimen label="Switch" column>
          <Label><Switch v-model="switchOn" :disabled="off" /> Show finished to-dos</Label>
          <Label><Switch v-model="switchOff" :disabled="off" /> Start on Home</Label>
        </Specimen>
        <Specimen label="Radio group">
          <RadioGroup v-model="radio" :disabled="off">
            <Label><RadioGroupItem value="compact" /> Compact</Label>
            <Label><RadioGroupItem value="normal" /> Normal</Label>
            <Label><RadioGroupItem value="roomy" /> Roomy</Label>
          </RadioGroup>
        </Specimen>
        <Specimen label="Segmented control">
          <SegmentedControl
            v-model="segment"
            label="Period"
            :disabled="off"
            :options="[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]"
          />
        </Specimen>
        <Specimen label="Select">
          <Select v-model="select" :disabled="off">
            <SelectTrigger class="w-56" aria-label="Game">
              <SelectValue placeholder="Pick a game" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Favorites</SelectLabel>
                <SelectItem value="poe2">Path of Exile 2</SelectItem>
                <SelectItem value="d4">Diablo IV</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Other games</SelectLabel>
                <SelectItem value="ff14">Final Fantasy XIV</SelectItem>
                <SelectItem value="gw2">Guild Wars 2</SelectItem>
                <SelectItem value="wow" disabled>World of Warcraft (not installed)</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select :disabled="off">
            <SelectTrigger size="sm" class="w-40" aria-label="Sort by">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recently changed</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
        <Specimen label="Slider" column>
          <div class="flex items-center gap-3">
            <Slider v-model="volume" :max="100" :step="1" class="w-full max-w-64" aria-label="Volume" :disabled="off" />
            <span class="text-muted-foreground text-xs tabular-nums">{{ volume[0] }}</span>
          </div>
          <div class="flex items-center gap-3">
            <Slider v-model="range" :max="100" :step="5" class="w-full max-w-64" aria-label="Level range" :disabled="off" />
            <span class="text-muted-foreground text-xs tabular-nums">{{ range[0] }}–{{ range[1] }}</span>
          </div>
        </Specimen>
      </DemoSection>

      <!-- Tabs -->
      <DemoSection v-if="visible.has('tabs')" id="tabs" :title="title('tabs')" description="Switch between views of the same thing. The selected tab carries a gold line, like panel tabs.">
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

      <!-- Badges and status -->
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
          <kbd class="bg-secondary rounded-sm border px-1.5 py-0.5 font-mono text-xs">Ctrl</kbd>
          <kbd class="bg-secondary rounded-sm border px-1.5 py-0.5 font-mono text-xs">K</kbd>
        </Specimen>
      </DemoSection>

      <!-- Progress and loading -->
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

      <!-- Menus -->
      <DemoSection v-if="visible.has('menus')" id="menus" :title="title('menus')" description="Every menu opens from a visible ⋯ button. Destructive items sit last, in red, after a separator.">
        <Specimen label="Dropdown menu">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="secondary" :disabled="off"><MoreHorizontal :stroke-width="1.5" /> Actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-56">
              <DropdownMenuLabel>Note</DropdownMenuLabel>
              <DropdownMenuItem><Pencil :stroke-width="1.5" /> Rename <DropdownMenuShortcut>F2</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem><Copy :stroke-width="1.5" /> Duplicate <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled><Pin :stroke-width="1.5" /> Pin (already pinned)</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Act 1</DropdownMenuItem>
                  <DropdownMenuItem>Act 2</DropdownMenuItem>
                  <DropdownMenuItem>Endgame</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem v-model="showRead">Show read notes</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup v-model="sort">
                <DropdownMenuRadioItem value="recent">Recently changed</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive"><Trash2 :stroke-width="1.5" /> Delete note</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button size="icon-sm" variant="ghost" aria-label="More" title="More" :disabled="off"><MoreHorizontal :stroke-width="1.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>Open</DropdownMenuItem>
              <DropdownMenuItem>Copy link</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Specimen>
      </DemoSection>

      <!-- Dialogs -->
      <DemoSection v-if="visible.has('dialogs')" id="dialogs" :title="title('dialogs')" description="420 px wide, a title and one sentence, buttons bottom right with the action last.">
        <Specimen label="Dialogs">
          <Button variant="secondary" :disabled="off" @click="renaming = true">Rename…</Button>
          <Button variant="secondary" class="text-destructive" :disabled="off" @click="confirming = true">Delete group…</Button>
        </Specimen>
        <Dialog v-model:open="renaming">
          <DialogContent class="top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle class="text-lg">Rename note</DialogTitle>
              <DialogDescription>The new name shows in the list and the panel tab.</DialogDescription>
            </DialogHeader>
            <form class="flex flex-col gap-4" @submit.prevent="renaming = false">
              <Input v-model="name" aria-label="Note name" autofocus />
              <DialogFooter>
                <Button type="button" variant="secondary" @click="renaming = false">Cancel</Button>
                <Button type="submit">Rename</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          v-if="confirming"
          title="Delete “Act 2”?"
          description="Its 4 to-dos are removed for good. This cannot be undone."
          confirm="Delete group"
          @confirm="confirming = false"
          @cancel="confirming = false"
        />
      </DemoSection>

      <!-- Lists and rows -->
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

      <!-- Notices -->
      <DemoSection v-if="visible.has('notices')" id="notices" :title="title('notices')" description="Inline notices inside a module. An icon and a sentence; colour only tints.">
        <div class="flex flex-col gap-2">
          <div role="status" class="bg-info/10 flex items-start gap-2 rounded-md p-3 text-sm">
            <Info class="text-info mt-0.5 size-4 flex-none" :stroke-width="1.5" />
            <span>Notes are shared by every panel of this module in the current game.</span>
          </div>
          <div role="status" class="bg-success/10 flex items-start gap-2 rounded-md p-3 text-sm">
            <CheckCircle2 class="text-success mt-0.5 size-4 flex-none" :stroke-width="1.5" />
            <span>Imported 24 to-dos.</span>
          </div>
          <div role="status" class="bg-warning/10 flex items-start gap-2 rounded-md p-3 text-sm">
            <AlertTriangle class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" />
            <span>This note is almost at its size limit.</span>
          </div>
          <div role="alert" class="bg-destructive/10 flex items-start gap-2 rounded-md p-3 text-sm">
            <XCircle class="text-destructive mt-0.5 size-4 flex-none" :stroke-width="1.5" />
            <span class="flex-1">Could not save. Your change is kept and will be tried again.</span>
            <Button size="xs" variant="secondary" :disabled="off">Retry</Button>
          </div>
        </div>
      </DemoSection>

      <!-- Empty state -->
      <DemoSection v-if="visible.has('empty')" id="empty" :title="title('empty')" description="One sentence and one action. No illustrations.">
        <div class="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
          <p class="text-muted-foreground text-sm">No notes for this game yet.</p>
          <Button :disabled="off"><Plus :stroke-width="1.5" /> New note</Button>
        </div>
      </DemoSection>
    </main>
  </div>
</template>
