<script setup lang="ts">
// Saved layouts of the current game: apply one, or save the current layout.
// Below them, templates: common arrangements of empty slots to fill with modules.
import { ChevronDown, LayoutPanelLeft } from "@lucide/vue";
import type { SnapshotView } from "../../../shared/host-api";
import { LAYOUT_TEMPLATES, type LayoutTemplateId } from "../../../shared/layout-templates";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { act, confirmAction, prompt, state, submitAction, type MenuItem } from "../../host";
import MenuButton from "../menus/MenuButton.vue";
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
    menu-class="w-80 max-w-80"
    class="flex h-8 w-auto gap-1.5 rounded-lg px-2.5 text-sm font-medium"
  >
    <LayoutPanelLeft class="size-4" :stroke-width="1.5" /> Layouts <ChevronDown class="size-3.5" :stroke-width="1.5" />
    <template #after>
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-muted-foreground text-xs font-normal">Templates</DropdownMenuLabel>
      <div class="grid grid-cols-3 gap-1 p-1 pt-0" role="group" aria-label="Templates">
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
    </template>
  </MenuButton>
</template>
