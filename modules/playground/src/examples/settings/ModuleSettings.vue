<script setup lang="ts">
// A small module settings dialog with made-up settings, to try the module-settings parts together.
import { Keyboard, Music, Paintbrush, Trash2, Type } from "@lucide/vue";
import { SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { ModuleSettings, SettingsMainBar, SettingsPage, SettingsPreview, SettingsRow, SettingsSection, settingsMenu } from "@tavora/official-ui/components/ui/module-settings";
import { SliderField } from "@tavora/official-ui/components/ui/slider";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { computed, ref } from "vue";

const DEFAULTS = { size: "m", bold: true, italic: false, color: "#ffffff", opacity: 70, overlay: true, autoplay: false };
const look = ref({ ...DEFAULTS });
const savedAt = ref<number>();
const page = ref("overlay");
const title = (id: string) => ({ player: "Player", hotkeys: "Hotkeys", look: "Look", game: "In game", stream: "On stream" })[id] ?? "";
const COLORS = ["#ffffff", "#facc15", "#fb923c", "#f87171", "#f472b6", "#a78bfa", "#60a5fa", "#2dd4bf", "#4ade80", "#000000"];
const SIZES = ["xs", "s", "m", "l", "xl"].map((value) => ({ value, label: value.toUpperCase() }));
const SIZE_PX: Record<string, number> = { xs: 12, s: 14, m: 16, l: 19, xl: 23 };

// The kit's menu: own pages, then Overlays with Text and Look, then In game and On stream with their dots.
const groups = computed(() =>
  settingsMenu({
    pages: [{ id: "player", label: "Player", icon: Music }, { id: "hotkeys", label: "Hotkeys", icon: Keyboard }],
    look: [{ id: "overlay", label: "Text", icon: Type }, { id: "look", label: "Look", icon: Paintbrush }],
    inGame: { id: "game", on: look.value.overlay },
    onStream: { id: "stream", on: false },
  }),
);

function set<K extends keyof typeof DEFAULTS>(key: K, value: (typeof DEFAULTS)[K]) {
  look.value = { ...look.value, [key]: value };
  savedAt.value = Date.now();
}
function reset() {
  const before = look.value;
  look.value = { ...DEFAULTS };
  return () => (look.value = before);
}
</script>

<template>
  <!-- 960 × 680 in the app; smaller here. A narrow panel scrolls it sideways. -->
  <div class="overflow-x-auto">
  <div class="bg-card h-[560px] w-[760px] overflow-hidden rounded-xl border">
    <ModuleSettings v-model:page="page" :groups="groups" label="Settings" :reset="reset" :resettable="(id) => id !== 'hotkeys'" :saved-at="savedAt">
      <SettingsPage v-if="page === 'overlay'" title="Text" description="What shows in the overlay while a song plays.">
        <template #main>
          <SettingsMainBar label="Show in your game" hint="Changes apply at once.">
            <Switch :model-value="look.overlay" aria-label="Show in your game" @update:model-value="set('overlay', $event)" />
          </SettingsMainBar>
        </template>
        <template #preview>
          <SettingsPreview label="Preview of the overlay">
            <div class="flex w-72 items-center gap-3 rounded-xl py-2.5 pr-4 pl-2.5" :style="{ background: `rgb(0 0 0 / ${look.opacity}%)`, color: look.color }">
              <span class="size-12 flex-none rounded-lg bg-[linear-gradient(135deg,#d4644a,#5b2b6e)]" />
              <span :style="{ fontSize: `${SIZE_PX[look.size]}px`, fontWeight: look.bold ? 700 : 400, fontStyle: look.italic ? 'italic' : 'normal' }">Dragonsreach</span>
            </div>
          </SettingsPreview>
        </template>
        <SettingsSection title="Text">
          <SettingsRow label="Title">
            <SegmentedControl :model-value="look.size" label="Title size" :options="SIZES" class="w-full min-w-0 [&>*]:flex-1 [&>*]:px-0" @update:model-value="set('size', $event)" />
            <Toggle :model-value="look.bold" label="Bold" class="font-bold" @update:model-value="set('bold', $event)">B</Toggle>
            <Toggle :model-value="look.italic" label="Italic" class="font-serif italic" @update:model-value="set('italic', $event)">I</Toggle>
          </SettingsRow>
          <SettingsRow label="Text colour">
            <ColorPicker :model-value="look.color" :colors="COLORS" label="Text colour" :columns="7" allow-custom @update:model-value="set('color', $event)" />
          </SettingsRow>
        </SettingsSection>
        <SettingsSection title="Background">
          <SettingsRow label="Opacity">
            <SliderField :model-value="look.opacity" :min="0" :max="100" :step="5" unit="%" label="Opacity" @update:model-value="set('opacity', $event)" />
          </SettingsRow>
        </SettingsSection>
      </SettingsPage>
      <SettingsPage v-else :title="title(page)" description="A page with only rows.">
        <SettingsSection>
          <SettingsRow label="Play when Tavora starts" hint="Picks up where you left off.">
            <Switch :model-value="look.autoplay" aria-label="Play when Tavora starts" @update:model-value="set('autoplay', $event)" />
          </SettingsRow>
        </SettingsSection>
        <!-- A row that deletes something sits last, with a red name and a destructive button. -->
        <SettingsSection v-if="page === 'player'">
          <SettingsRow label="Delete this player" hint="You can undo it for a few seconds." danger>
            <Button variant="destructive" size="sm"><Trash2 :stroke-width="1.5" />Delete</Button>
          </SettingsRow>
        </SettingsSection>
      </SettingsPage>
    </ModuleSettings>
  </div>
  </div>
</template>
