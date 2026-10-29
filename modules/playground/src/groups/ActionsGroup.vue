<script setup lang="ts">
import { Bold, ChevronDown, ChevronRight, CircleHelp, Copy, Folder, FolderInput, FolderPlus, Italic, Loader2, MoreHorizontal, Pencil, Pin, Plus, Settings, Trash2 } from "@lucide/vue";
import { ConfirmDialog, Tooltip, TooltipRows, type TooltipRow } from "@tavora/official-ui";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@tavora/official-ui/components/ui/context-menu";
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
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@tavora/official-ui/components/ui/popover";
import { toast } from "@tavora/official-ui/components/ui/toast";
import { ref } from "vue";
import DemoSection from "../DemoSection.vue";
import Specimen from "../Specimen.vue";
import { type SectionId, sectionTitle as title } from "../sections";

defineProps<{ visible: Set<SectionId>; off: boolean }>();

/** The rich tooltip examples: which one is open, and the box of the thing it is for. */
const tip = ref<{ open: string | null; anchor: { left: number; top: number; right: number; bottom: number } }>({ open: null, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
function showTip(name: string, e: Event) {
  const { left, top, right, bottom } = (e.currentTarget as HTMLElement).getBoundingClientRect();
  tip.value = { open: name, anchor: { left, top, right, bottom } };
}
const hideTip = () => (tip.value.open = null);
const tipOn = (name: string) => ({ onPointerenter: (e: Event) => showTip(name, e), onPointerleave: hideTip, onFocus: (e: Event) => showTip(name, e), onBlur: hideTip });
const chartRows: TooltipRow[] = [{ label: "Play time", value: "3 h 12 min" }, { label: "vs. last week", value: "+48 min", trend: "better" }];
const itemRows: TooltipRow[] = [{ label: "Damage", value: "142" }, { label: "Crit chance", value: "+8%", trend: "better" }, { label: "Stamina use", value: "+12%", trend: "worse" }];
const bars = [40, 55, 35, 80, 60, 45, 70];
/** A pretend save for the loading toast: done, or failed, after a moment. */
const wait = (ms: number, fail = false) => new Promise<void>((resolve, reject) => setTimeout(() => (fail ? reject(new Error("failed")) : resolve()), ms));
const showRead = ref(true);
const sort = ref("recent");
const name = ref("Waystone");
const confirming = ref(false);
const renaming = ref(false);
</script>

<template>
<DemoSection v-if="visible.has('buttons')" id="buttons" :title="title('buttons')" description="One primary button per view; secondary for everything else.">
        <Specimen label="Variants">
          <Button :disabled="off">Primary</Button>
          <Button variant="secondary" :disabled="off">Secondary</Button>
          <Button variant="outline" :disabled="off">Outline</Button>
          <Button variant="ghost" :disabled="off">Ghost</Button>
          <Button variant="destructive" :disabled="off">Delete for good</Button>
          <Button variant="danger" :disabled="off">Remove</Button>
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
        <Specimen label="Icon only (each has a label and a shared tooltip)">
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
        <Specimen label="Split buttons (an action with its ▾ menu)">
          <ButtonGroup label="Add a module">
            <Button size="sm" variant="secondary" :disabled="off"><Plus :stroke-width="1.5" /> Add module</Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button size="sm" variant="secondary" class="px-1.5" aria-label="Modules in this workspace" title="Modules in this workspace" :disabled="off"><ChevronDown :stroke-width="1.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Notes</DropdownMenuItem>
                <DropdownMenuItem>To-dos</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
          <ButtonGroup label="Add all">
            <Button size="sm" variant="outline" :disabled="off">Add all</Button>
            <Button size="sm" variant="outline" class="px-2" aria-label="Show panels" title="Show panels" :disabled="off"><ChevronDown :stroke-width="1.75" /></Button>
          </ButtonGroup>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('tooltips')" id="tooltips" :title="title('tooltips')" description="Hover help sits beside the control with a small gap, only its arrow pointing at it. Works with a mouse and keyboard.">
        <Specimen label="From a title (any element)">
          <Button title="Readable help from the shared kit." :disabled="off">Hover or focus me</Button>
          <Button size="icon" variant="secondary" aria-label="Duplicate" title="Duplicate" aria-keyshortcuts="Control+D" :disabled="off"><Copy :stroke-width="1.5" /></Button>
          <span title="Add a name and an icon first." tabindex="0"><Button disabled class="pointer-events-none">Publish</Button></span>
          <span class="text-muted-foreground max-w-40 truncate rounded-md border px-2 py-1.5 text-sm" title="D:\Games\Steam\steamapps\common\Enshrouded\Saves">D:\Games\Steam\steamapps\common\Enshrouded\Saves</span>
        </Specimen>
        <Specimen label="Rich: title, text, shortcut, warning">
          <Button variant="ghost" size="icon-sm" aria-label="About starting with Windows" v-bind="tipOn('help')" :disabled="off"><CircleHelp :stroke-width="1.5" /></Button>
          <Button variant="secondary" v-bind="tipOn('rich')" :disabled="off">Rich tooltip</Button>
          <Button variant="outline" class="text-warning" v-bind="tipOn('warning')" :disabled="off">92% used</Button>
        </Specimen>
        <Specimen label="Values: a chart bar, a game item">
          <div class="flex h-16 items-end gap-1.5">
            <button v-for="(height, index) in bars" :key="index" class="bg-primary/30 hover:bg-primary focus-visible:bg-primary w-6 rounded-t-sm" :style="{ height: height + '%' }" :aria-label="'Day ' + (index + 1)" v-bind="tipOn('chart')" />
          </div>
          <Button variant="outline" class="size-12 text-xl" aria-label="Wolfbane Longbow" v-bind="tipOn('item')" :disabled="off">🏹</Button>
        </Specimen>
        <Tooltip :open="tip.open === 'help'" :anchor="tip.anchor" title="Start with Windows" description="Tavora opens quietly in the tray when you sign in. Your overlays are ready when the game starts." @dismiss="hideTip" />
        <Tooltip :open="tip.open === 'rich'" :anchor="tip.anchor" title="A place worth exploring" shortcut="Ctrl+K" description="Readable text that wraps in narrow panels." @dismiss="hideTip" />
        <Tooltip :open="tip.open === 'warning'" :anchor="tip.anchor" tone="warning" title="Almost at your limit" description="Resets Friday at 09:00. You can still use 8% this week." @dismiss="hideTip" />
        <Tooltip :open="tip.open === 'chart'" :anchor="tip.anchor" side="top" title="Thursday" @dismiss="hideTip"><TooltipRows :rows="chartRows" /></Tooltip>
        <Tooltip :open="tip.open === 'item'" :anchor="tip.anchor" side="right" title="Wolfbane Longbow" description="Ranged · Level 25" @dismiss="hideTip">
          <Separator /><TooltipRows :rows="itemRows" /><Separator /><p>Arrows pierce the first enemy.</p>
        </Tooltip>
      </DemoSection>

<DemoSection v-if="visible.has('menus')" id="menus" :title="title('menus')" description="Every menu opens from a visible ⋯ button. Icons go on every entry or on none. Destructive items sit last, in red, after a separator.">
        <Specimen label="Dropdown menu">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="secondary" :disabled="off"><MoreHorizontal :stroke-width="1.5" /> Actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-56">
              <DropdownMenuLabel>Note</DropdownMenuLabel>
              <DropdownMenuItem><Pencil /> Rename <DropdownMenuShortcut>F2</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem><Copy /> Duplicate <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled><Pin /> Pin (already pinned)</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><FolderInput /> Move to group</DropdownMenuSubTrigger>
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
              <DropdownMenuItem variant="destructive"><Trash2 /> Delete note</DropdownMenuItem>
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
        <Specimen label="Right-click menu">
          <ContextMenu>
            <ContextMenuTrigger :disabled="off" class="text-muted-foreground flex h-16 w-56 items-center justify-center rounded-md border border-dashed text-sm">
              Right-click here
            </ContextMenuTrigger>
            <ContextMenuContent class="w-48">
              <ContextMenuItem><Pencil /> Rename</ContextMenuItem>
              <ContextMenuItem><Copy /> Duplicate</ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger><FolderInput /> Move to folder</ContextMenuSubTrigger>
                <ContextMenuSubContent class="w-44">
                  <ContextMenuItem><Folder /> Act 1</ContextMenuItem>
                  <ContextMenuItem><Folder /> Endgame</ContextMenuItem>
                  <ContextMenuItem><FolderPlus /> New folder…</ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive"><Trash2 /> Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('popovers')" id="popovers" :title="title('popovers')" description="A small panel next to a button for a quick edit. Escape or a click outside closes it.">
        <Specimen label="Popover with a field">
          <Popover>
            <PopoverTrigger as-child>
              <Button variant="secondary" :disabled="off">Rename</Button>
            </PopoverTrigger>
            <PopoverContent align="start" class="flex flex-col gap-2">
              <Input v-model="name" aria-label="Name" />
              <div class="flex justify-end">
                <PopoverClose as-child><Button size="sm">Done</Button></PopoverClose>
              </div>
            </PopoverContent>
          </Popover>
        </Specimen>
      </DemoSection>

<DemoSection
        v-if="visible.has('toasts')"
        id="toasts"
        :title="title('toasts')"
        description="A short message in a pill, where the user wants it (Settings > Appearance). Up to three stack; pointing at them spreads them out and stops their time."
      >
        <Specimen label="Kinds">
          <Button variant="secondary" :disabled="off" @click="toast({ title: 'Copied' })">Plain</Button>
          <Button variant="secondary" :disabled="off" @click="toast.success('Saved')">Success</Button>
          <Button variant="secondary" :disabled="off" @click="toast.info('Update ready', { action: { label: 'Restart', onClick: () => toast({ title: 'Restarting' }) } })">Info</Button>
          <Button variant="secondary" :disabled="off" @click="toast.warning('Almost out of space')">Warning</Button>
          <Button variant="secondary" :disabled="off" @click="toast.error('Can’t save right now')">Error</Button>
        </Specimen>
        <Specimen label="Loading, then done">
          <Button variant="secondary" :disabled="off" @click="toast.promise(wait(1500), { loading: 'Saving…', success: 'Saved', error: 'Can’t save' })">Works</Button>
          <Button variant="secondary" :disabled="off" @click="toast.promise(wait(1500, true), { loading: 'Saving…', success: 'Saved', error: 'Can’t save' }).catch(() => undefined)">Fails</Button>
        </Specimen>
        <Specimen label="With a button">
          <Button variant="secondary" :disabled="off" @click="toast({ title: 'To-do deleted', action: { label: 'Undo', onClick: () => toast({ title: 'Brought back' }) } })">With Undo</Button>
          <Button
            variant="secondary"
            :disabled="off"
            @click="toast({ title: 'Deleted “Shopping”', duration: 10000, action: { label: 'Undo', onClick: () => toast({ title: 'Brought back' }) } })"
          >
            Long Undo (10 s)
          </Button>
          <Button variant="secondary" :disabled="off" @click="toast({ title: 'Note deleted', description: '“Boss route” is gone.' })">Second line</Button>
        </Specimen>
      </DemoSection>

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
</template>
