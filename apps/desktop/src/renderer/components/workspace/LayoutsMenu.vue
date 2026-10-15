<script setup lang="ts">
// Saved layouts of the current game: apply one, or save the current layout.
// Below them, templates: common arrangements of empty slots to fill with modules.
import { ChevronDown, LayoutPanelLeft } from "@lucide/vue";
import type { SnapshotView } from "../../../shared/host-api";
import { LAYOUT_TEMPLATES } from "../../../shared/layout-templates";
import { act, confirmAction, prompt, state, submitAction, type MenuItem } from "../../host";
import MenuButton from "../menus/MenuButton.vue";

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
    ...LAYOUT_TEMPLATES.map((template, index) => ({
      label: template.name,
      testid: `layout-template-${template.id}`,
      heading: index === 0 ? "Templates" : undefined,
      run: () => act({ type: "apply-layout-template", templateId: template.id }),
    })),
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
    class="flex h-8 w-auto gap-1.5 rounded-lg px-2.5 text-sm font-medium"
  >
    <LayoutPanelLeft class="size-4" :stroke-width="1.5" /> Layouts <ChevronDown class="size-3.5" :stroke-width="1.5" />
  </MenuButton>
</template>
