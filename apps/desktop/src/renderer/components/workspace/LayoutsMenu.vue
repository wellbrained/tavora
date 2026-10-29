<script setup lang="ts">
// Saved layouts of the current workspace: apply one, or save the current layout.
// Below them, a Templates submenu (uneven arrangements of empty slots to fill
// with modules) and a picker for even grids.
import { Bookmark, Check, ChevronDown, LayoutPanelLeft, LayoutTemplate, Pencil, RefreshCw, Save, Trash2 } from "@lucide/vue";
import type { SnapshotView } from "../../../shared/host-api";
import { LAYOUT_TEMPLATES, type LayoutTemplateId } from "../../../shared/layout-templates";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { act, confirmAction, prompt, state, submitAction, type MenuItem } from "../../host";
import { t, templateName } from "../../i18n";
import MenuButton from "../menus/MenuButton.vue";
import GridPicker from "./GridPicker.vue";
import TemplatePreview from "./TemplatePreview.vue";

function saveAs() {
  prompt({
    title: t("layouts.save.title"),
    label: t("layouts.name"),
    confirm: t("common.save"),
    submit: (name) => submitAction({ type: "save-snapshot", name }),
  });
}

function snapshotItems(snapshot: SnapshotView): MenuItem[] {
  return [
    { label: t("layouts.apply"), testid: "layout-apply", glyph: Check, run: () => act({ type: "apply-snapshot", snapshotId: snapshot.id }) },
    {
      label: t("layouts.replace"),
      testid: "layout-update",
      glyph: RefreshCw,
      run: () => act({ type: "update-snapshot", snapshotId: snapshot.id }),
    },
    {
      label: t("menu.rename"),
      testid: "layout-rename",
      glyph: Pencil,
      run: () =>
        prompt({
          title: t("layouts.rename.title"),
          label: t("layouts.name"),
          value: snapshot.name,
          confirm: t("menu.rename.confirm"),
          submit: (name) => submitAction({ type: "rename-snapshot", snapshotId: snapshot.id, name }),
        }),
    },
    {
      label: t("layouts.delete"),
      testid: "layout-delete",
      glyph: Trash2,
      danger: true,
      run: () =>
        confirmAction({
          title: t("layouts.delete.title", { name: snapshot.name }),
          message: t("layouts.delete.message"),
          confirm: t("layouts.delete.confirm"),
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
      glyph: Bookmark,
      submenu: () => snapshotItems(snapshot),
    })),
    {
      label: t("layouts.saveCurrent"),
      testid: "layout-save",
      glyph: Save,
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
    :title="t('layouts.title')"
    testid="layouts"
    :label="t('layouts.title')"
    side="bottom"
    align="end"
    menu-class="w-72"
    class="text-foreground focus-visible:ring-ring/50 flex h-9 w-auto gap-2 rounded-md px-3 text-sm font-medium transition-colors outline-none hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] focus-visible:ring-3 data-[state=open]:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))]"
  >
    <LayoutPanelLeft class="size-5" :stroke-width="2" absolute-stroke-width /> {{ t("layouts.button") }} <ChevronDown class="size-4" :stroke-width="2" absolute-stroke-width />
    <template #after>
      <DropdownMenuSeparator />
      <!-- Templates sit one level down, so the grid picker stays in the main menu. -->
      <DropdownMenuSub>
        <!-- The safe zone toward the submenu lasts 1.5 s instead of 0.3 s: the way to it crosses the grid
             picker, and an unhurried mouse must not highlight a grid cell and close the submenu. -->
        <DropdownMenuSubTrigger data-testid="layout-templates" :grace-duration="1500">
          <LayoutTemplate aria-hidden="true" /> {{ t("layouts.templates") }}
        </DropdownMenuSubTrigger>
        <!-- Opens level with the Templates entry: -5 offsets the panel's border and padding. -->
        <DropdownMenuSubContent class="w-auto" side="right" align="start" :align-offset="-5">
          <div class="grid grid-cols-2 gap-1" role="group" :aria-label="t('layouts.templates')">
            <DropdownMenuItem
              v-for="template in LAYOUT_TEMPLATES"
              :key="template.id"
              class="group justify-center p-2"
              :data-testid="`layout-template-${template.id}`"
              :aria-label="templateName(template)"
              :title="templateName(template)"
              @select="apply(template.id)"
            >
              <!-- size-auto keeps the menu item's default 16 px icon size off the preview. -->
              <TemplatePreview :template="template" class="text-muted-foreground group-data-[highlighted]:text-primary size-auto h-14 w-[84px]" />
            </DropdownMenuItem>
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-muted-foreground text-xs font-normal">{{ t("layouts.grid") }}</DropdownMenuLabel>
      <GridPicker />
    </template>
  </MenuButton>
</template>
