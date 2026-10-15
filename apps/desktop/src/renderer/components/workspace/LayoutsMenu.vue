<script setup lang="ts">
// Saved layouts of the current game: apply one, or save the current layout.
// Below them, a Templates submenu (uneven arrangements of empty slots to fill
// with modules) and a picker for even grids.
import { ChevronDown, LayoutPanelLeft, LayoutTemplate } from "@lucide/vue";
import type { SnapshotView } from "../../../shared/host-api";
import { LAYOUT_TEMPLATES, type LayoutTemplateId } from "../../../shared/layout-templates";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { act, confirmAction, prompt, state, submitAction, type MenuItem } from "../../host";
import MenuButton from "../menus/MenuButton.vue";
import GridPicker from "./GridPicker.vue";
import TemplatePreview from "./TemplatePreview.vue";

function saveAs() {
  prompt({
    title: "Save layout",
    label: "Layout name",
    confirm: "Save",
    submit: (name) => submitAction({ type: "save-snapshot", name }),
  });
}

function snapshotItems(snapshot: SnapshotView): MenuItem[] {
  return [
    { label: "Apply", testid: "layout-apply", run: () => act({ type: "apply-snapshot", snapshotId: snapshot.id }) },
    {
      label: "Replace with current layout",
      testid: "layout-update",
      run: () => act({ type: "update-snapshot", snapshotId: snapshot.id }),
    },
    {
      label: "Rename…",
      testid: "layout-rename",
      run: () =>
        prompt({
          title: "Rename layout",
          label: "Layout name",
          value: snapshot.name,
          confirm: "Rename",
          submit: (name) => submitAction({ type: "rename-snapshot", snapshotId: snapshot.id, name }),
        }),
    },
    {
      label: "Delete",
      testid: "layout-delete",
      danger: true,
      run: () =>
        confirmAction({
          title: `Delete the layout "${snapshot.name}"?`,
          message: "Only the saved arrangement is deleted. Open panels and module data stay as they are.",
          confirm: "Delete layout",
          danger: true,
          run: () => submitAction({ type: "delete-snapshot", snapshotId: snapshot.id }),
        }),
    },
  ];
}

/** Runs after the menu has closed, like the other menu entries. */
function apply(templateId: LayoutTemplateId) {
  setTimeout(() => void act({ type: "apply-layout-template", templateId }), 0);
}

function items(): MenuItem[] {
  const view = state.value!;
  return [
    ...view.snapshots.map((snapshot) => ({
      label: snapshot.name,
      testid: `layout-${snapshot.id}`,
      submenu: () => snapshotItems(snapshot),
    })),
    {
      label: "Save current layout…",
      testid: "layout-save",
      separator: true,
      disabled: view.panels.length === 0,
      run: saveAs,
    },
  ];
}
</script>

<template>
  <MenuButton
    :items="items"
    title="Saved layouts"
    testid="layouts"
    label="Saved layouts"
    side="bottom"
    align="end"
    menu-class="w-72"
    class="flex h-8 w-auto gap-1.5 rounded-lg px-2.5 text-sm font-medium"
  >
    <LayoutPanelLeft class="size-4" :stroke-width="1.5" /> Layouts <ChevronDown class="size-3.5" :stroke-width="1.5" />
    <template #after>
      <DropdownMenuSeparator />
      <!-- Templates sit one level down, so the grid picker stays in the main menu. -->
      <DropdownMenuSub>
        <!-- The safe zone toward the submenu lasts 1.5 s instead of 0.3 s: the way to it crosses the grid
             picker, and an unhurried mouse must not highlight a grid cell and close the submenu. -->
        <DropdownMenuSubTrigger data-testid="layout-templates" :grace-duration="1500">
          <LayoutTemplate class="size-4" :stroke-width="1.5" /> Templates
        </DropdownMenuSubTrigger>
        <!-- Opens level with the Templates entry: -5 offsets the panel's border and padding. -->
        <DropdownMenuSubContent class="w-auto" side="right" align="start" :align-offset="-5">
          <div class="grid grid-cols-2 gap-1" role="group" aria-label="Templates">
            <DropdownMenuItem
              v-for="template in LAYOUT_TEMPLATES"
              :key="template.id"
              class="group justify-center p-2"
              :data-testid="`layout-template-${template.id}`"
              :aria-label="template.name"
              :title="template.name"
              @select="apply(template.id)"
            >
              <!-- size-auto keeps the menu item's default 16 px icon size off the preview. -->
              <TemplatePreview :template="template" class="text-muted-foreground group-data-[highlighted]:text-primary size-auto h-14 w-[84px]" />
            </DropdownMenuItem>
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-muted-foreground text-xs font-normal">Grid</DropdownMenuLabel>
      <GridPicker />
    </template>
  </MenuButton>
</template>
