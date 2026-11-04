<script setup lang="ts">
// The toolbar: the spreadsheet picker with its actions, then undo, looks, format, colours, sort and filter, and a
// visible ··· with the rest. In a narrow panel everything but the picker folds into ···.
import { AlignLeft, ArrowDownUp, Bold, ChevronDown, Copy, FilePlus2, Gamepad2, Italic, MoreHorizontal, Palette, Pencil, Redo2, Settings, Table2, Trash2, Undo2 } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { Popover, PopoverContent, PopoverTrigger } from "@tavora/official-ui/components/ui/popover";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { useElementSize } from "@vueuse/core";
import { computed, inject, ref } from "vue";
import { PANEL } from "./context";
import { t } from "./i18n";
import { COLORS, type ColorName } from "./model";
import { TEMPLATES } from "./templates";
import ToolMenus from "./ToolMenus.vue";

const panel = inject(PANEL)!;
const session = computed(() => panel.session.value!);
const active = computed(() => panel.selection.value.active);
const look = computed(() => {
  void session.value.version.value;
  return session.value.styleOf(active.value.row, active.value.col);
});

const bar = ref<HTMLElement | null>(null);
const { width } = useElementSize(bar);
/** Below this the buttons fold into ···; the picker always stays. */
const narrow = computed(() => width.value > 0 && width.value < 600);

const options = computed(() => panel.spreadsheets.value.map((entry) => ({ value: entry.id, label: entry.name })));
const picked = computed({
  get: () => panel.currentId.value ?? "",
  set: (id: string) => panel.open(id),
});

const toggle = (key: "bold" | "italic") => session.value.toggleStyle(panel.range.value, active.value, key);
const undo = () => panel.refused(session.value.undo());
const redo = () => panel.refused(session.value.redo());

// The six colours as swatches, by their theme variable; the picked one goes back by name.
const swatches = COLORS.map((name) => `var(--${name})`);
const swatchLabels = computed(() => COLORS.map((name) => t(`color.${name}`)));
const colorOf = (kind: "color" | "fill") => (look.value[kind] ? `var(--${look.value[kind]})` : "");
function setColor(kind: "color" | "fill", value: string | null) {
  const name = value ? (/^var\(--(.+)\)$/.exec(value)?.[1] as ColorName | undefined) : undefined;
  session.value.styleRange(panel.range.value, { [kind]: name });
}
</script>

<template>
  <header ref="bar" class="flex h-11 flex-none items-center gap-1 border-b border-border bg-card px-2" role="toolbar" :aria-label="t('toolbar')" data-testid="toolbar">
    <ButtonGroup :label="t('picker.label')" class="min-w-0">
      <Picker v-model="picked" :options="options" :label="t('picker.label')" :search="t('picker.search')" :empty="t('picker.empty')" size="sm" class="max-w-48 min-w-28" testid="picker" />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button size="sm" variant="secondary" class="px-1.5" :aria-label="t('picker.actions')" :title="t('picker.actions')" data-testid="picker-actions"><ChevronDown :stroke-width="1.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="min-w-52">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><FilePlus2 :stroke-width="1.5" /> {{ t("new") }}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem v-for="template in TEMPLATES" :key="template" :data-testid="`new-${template}`" @select="panel.create(template)">
                <Table2 :stroke-width="1.5" /> {{ template === "blank" ? t("new.blank") : t(`tpl.${template}.name`) }}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem @select="panel.openDialog('rename')"><Pencil :stroke-width="1.5" /> {{ t("rename") }}</DropdownMenuItem>
          <DropdownMenuItem @select="panel.duplicate()"><Copy :stroke-width="1.5" /> {{ t("duplicate") }}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" data-testid="delete-spreadsheet" @select="panel.remove()"><Trash2 :stroke-width="1.5" /> {{ t("delete") }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>

    <template v-if="!narrow">
      <Separator orientation="vertical" class="mx-1 h-5" />
      <Button variant="ghost" size="icon-sm" :disabled="!session.canUndo.value" :aria-label="t('undo')" :title="`${t('undo')} (Ctrl+Z)`" @click="undo"><Undo2 :stroke-width="1.5" /></Button>
      <Button variant="ghost" size="icon-sm" :disabled="!session.canRedo.value" :aria-label="t('redo')" :title="`${t('redo')} (Ctrl+Y)`" @click="redo"><Redo2 :stroke-width="1.5" /></Button>
      <Separator orientation="vertical" class="mx-1 h-5" />
      <Toggle :model-value="!!look.bold" :label="`${t('bold')} (Ctrl+B)`" @update:model-value="toggle('bold')"><Bold :stroke-width="1.75" /></Toggle>
      <Toggle :model-value="!!look.italic" :label="`${t('italic')} (Ctrl+I)`" @update:model-value="toggle('italic')"><Italic :stroke-width="1.75" /></Toggle>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="gap-1 px-1.5" :aria-label="t('align')" :title="t('align')"><AlignLeft :stroke-width="1.5" /><ChevronDown class="size-3.5" :stroke-width="1.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start"><ToolMenus part="align" /></DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="gap-1 px-2" data-testid="format-menu">{{ t("format") }}<ChevronDown class="size-3.5" :stroke-width="1.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="min-w-48"><ToolMenus part="format" /></DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger as-child>
          <Button variant="ghost" size="sm" class="gap-1 px-1.5" :aria-label="t('colors')" :title="t('colors')"><Palette :stroke-width="1.5" /><ChevronDown class="size-3.5" :stroke-width="1.5" /></Button>
        </PopoverTrigger>
        <PopoverContent align="start" class="flex w-auto flex-col gap-3">
          <div v-for="kind in ['color', 'fill'] as const" :key="kind" class="flex flex-col gap-2">
            <Label>{{ t(kind === "color" ? "colors.text" : "colors.fill") }}</Label>
            <div class="flex items-center gap-2">
              <ColorPicker :model-value="colorOf(kind)" :colors="swatches" :labels="swatchLabels" :label="t(kind === 'color' ? 'colors.text' : 'colors.fill')" @update:model-value="(value) => setColor(kind, value)" />
              <Button variant="ghost" size="xs" :disabled="!look[kind]" @click="setColor(kind, null)">{{ t("colors.none") }}</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="gap-1 px-1.5" :aria-label="t('sort')" :title="t('sort')" data-testid="sort-menu"><ArrowDownUp :stroke-width="1.5" /><ChevronDown class="size-3.5" :stroke-width="1.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="min-w-56"><ToolMenus part="sort" /></DropdownMenuContent>
      </DropdownMenu>
    </template>

    <div class="min-w-0 flex-1" />
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon-sm" :aria-label="t('more')" :title="t('more')" data-testid="more-menu"><MoreHorizontal :stroke-width="1.5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-56">
        <template v-if="narrow">
          <DropdownMenuItem :disabled="!session.canUndo.value" @select="undo"><Undo2 :stroke-width="1.5" /> {{ t("undo") }}</DropdownMenuItem>
          <DropdownMenuItem :disabled="!session.canRedo.value" @select="redo"><Redo2 :stroke-width="1.5" /> {{ t("redo") }}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="toggle('bold')"><Bold :stroke-width="1.5" /> {{ t("bold") }}</DropdownMenuItem>
          <DropdownMenuItem @select="toggle('italic')"><Italic :stroke-width="1.5" /> {{ t("italic") }}</DropdownMenuItem>
          <DropdownMenuSub v-for="part in ['align', 'format', 'colors', 'sort'] as const" :key="part">
            <DropdownMenuSubTrigger>{{ t(part) }}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent class="min-w-48"><ToolMenus :part="part" /></DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
        </template>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{{ t("rows") }}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent class="min-w-52"><ToolMenus part="rows" /></DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{{ t("freeze") }}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent class="min-w-48"><ToolMenus part="freeze" /></DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{{ t("files") }}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent class="min-w-56"><ToolMenus part="files" /></DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="show-in-game" @select="panel.showInGame(true)"><Gamepad2 :stroke-width="1.5" /> {{ t("live.show") }}</DropdownMenuItem>
        <DropdownMenuItem v-if="panel.liveOn.value" @select="panel.showInGame(false)">{{ t("live.stop") }}</DropdownMenuItem>
        <DropdownMenuItem data-testid="settings" @select="panel.openSettings()"><Settings :stroke-width="1.5" /> {{ t("settings") }}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </header>
</template>
