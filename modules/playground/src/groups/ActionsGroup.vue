<script setup lang="ts">
import { Bold, ChevronDown, ChevronRight, Copy, Italic, Loader2, MoreHorizontal, Pencil, Pin, Plus, Settings, Trash2 } from "@lucide/vue";
import { ConfirmDialog, Tooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@tavora/official-ui/components/ui/context-menu";
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

const tooltipDemo = ref({ open: false, at: { x: 0, y: 0 } });
function showTooltipDemo(e: PointerEvent | FocusEvent) {
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
  tooltipDemo.value = { open: true, at: e instanceof PointerEvent ? { x: e.clientX, y: e.clientY } : { x: b.right, y: b.top } };
}
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

<DemoSection v-if="visible.has('tooltips')" id="tooltips" :title="title('tooltips')" description="Shared readable hover help: 18 px titles, 14 px text. Works with a mouse and keyboard."><Specimen label="Hover help"><Button title="Readable help from the shared kit." :disabled="off">Hover or focus me</Button><Button @pointerenter="showTooltipDemo" @pointerleave="tooltipDemo.open=false" @focus="showTooltipDemo" @blur="tooltipDemo.open=false">Rich tooltip</Button><Tooltip :open="tooltipDemo.open" :at="tooltipDemo.at" title="A place worth exploring" description="Readable text stays beside your pointer and wraps in narrow panels." @dismiss="tooltipDemo.open=false"/></Specimen></DemoSection>

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
        <Specimen label="Right-click menu">
          <ContextMenu>
            <ContextMenuTrigger :disabled="off" class="text-muted-foreground flex h-16 w-56 items-center justify-center rounded-md border border-dashed text-sm">
              Right-click here
            </ContextMenuTrigger>
            <ContextMenuContent class="w-48">
              <ContextMenuItem><Pencil :stroke-width="1.5" /> Rename</ContextMenuItem>
              <ContextMenuItem><Copy :stroke-width="1.5" /> Duplicate</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive"><Trash2 :stroke-width="1.5" /> Delete</ContextMenuItem>
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

<DemoSection v-if="visible.has('toasts')" id="toasts" :title="title('toasts')" description="A short message at the bottom that goes away on its own. It waits while you hover it, and may carry one button.">
        <Specimen label="Show a toast">
          <Button variant="secondary" :disabled="off" @click="toast({ title: 'Saved' })">Plain</Button>
          <Button
            variant="secondary"
            :disabled="off"
            @click="toast({ title: 'To-do deleted', description: 'It is gone from this group.', action: { label: 'Undo', onClick: () => toast({ title: 'Brought back' }) } })"
          >
            With Undo
          </Button>
          <Button
            variant="secondary"
            :disabled="off"
            @click="toast({ title: 'Deleted “Shopping”', duration: 10000, action: { label: 'Undo', onClick: () => toast({ title: 'Brought back' }) } })"
          >
            Long Undo (10 s)
          </Button>
          <Button variant="secondary" :disabled="off" @click="toast({ title: 'Could not save', description: 'Try again in a moment.', variant: 'error' })">Error</Button>
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
