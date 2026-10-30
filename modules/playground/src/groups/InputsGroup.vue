<script setup lang="ts">
import { Search, X } from "@lucide/vue";
import { SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { CodeInput, codeDigits } from "@tavora/official-ui/components/ui/code-input";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@tavora/official-ui/components/ui/combobox";
import { Input } from "@tavora/official-ui/components/ui/input";
import { NumberField } from "@tavora/official-ui/components/ui/number-field";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Slider, SliderField } from "@tavora/official-ui/components/ui/slider";
import { StyleTiles } from "@tavora/official-ui/components/ui/style-tiles";
import { StarRating } from "@tavora/official-ui/components/ui/star-rating";
import { Switch, SwitchField } from "@tavora/official-ui/components/ui/switch";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { Toggle, ToggleGroup } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";
import DemoSection from "../DemoSection.vue";
import Specimen from "../Specimen.vue";
import { type SectionId, sectionTitle as title } from "../sections";

defineProps<{ visible: Set<SectionId>; off: boolean }>();

const SWATCHES = ["#ffffff", "#facc15", "#fb923c", "#f87171", "#60a5fa", "#4ade80", "#111111"];
const SWATCH_NAMES = ["White", "Yellow", "Orange", "Red", "Blue", "Green", "Black"];
const swatchColor = ref("#60a5fa");
const checked = ref(true);
const unchecked = ref(false);
const mixed = ref<boolean | "indeterminate">("indeterminate");
const switchOn = ref(true);
const switchOff = ref(false);
const radio = ref("normal");
const segment = ref<"day" | "week" | "month">("week");
const select = ref("poe2");
const optional = ref("ranger");
const notify = ref(true);
const quiet = ref(false);
const picked = ref<string>();
const pickedGame = ref("satisfactory");
const pickedLanguage = ref("en");
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English", keywords: "englisch" },
  { value: "de", label: "Deutsch", keywords: "german" },
  { value: "fr", label: "Français", keywords: "french" },
  { value: "es", label: "Español", keywords: "spanish" },
  { value: "ja", label: "日本語", keywords: "japanese" },
];
const code = ref("");
const GAMES = ["Path of Exile 2", "Diablo IV", "Final Fantasy XIV", "Guild Wars 2", "Satisfactory", "Stardew Valley", "Enshrouded"];
const volume = ref([60]);
const copies = ref(10);
const opacity = ref(70);
const bold = ref(true);
const italic = ref(false);
const formats = ref<("bold" | "italic" | "underline")[]>(["bold"]);
const style = ref<"card" | "bar" | "minimal">("card");
const STYLES = [
  { value: "card" as const, label: "Card" },
  { value: "bar" as const, label: "Bar" },
  { value: "minimal" as const, label: "Minimal" },
];
const range = ref([20, 80]);
const stars = ref(0);
const text = ref("");
const search = ref("");
const notes = ref("");
const name = ref("Waystone");
</script>

<template>
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
          <Label for="pg-error-area">Text area with an error</Label>
          <Textarea id="pg-error-area" model-value="Hi" aria-invalid="true" aria-describedby="pg-error-area-text" :disabled="off" />
          <p id="pg-error-area-text" class="text-destructive text-xs">Write at least a sentence.</p>
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
          <Label for="pg-code">Code (digits only, pasted spaces are fine)</Label>
          <CodeInput id="pg-code" v-model="code" placeholder="123 456" :disabled="off" />
          <p class="text-muted-foreground text-xs">{{ codeDigits(code).length === 6 ? "Ready: " + codeDigits(code) : "Six digits" }}</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="pg-notes">Text area (grows with its text)</Label>
          <Textarea id="pg-notes" v-model="notes" placeholder="Details, links, anything else" :disabled="off" />
        </div>
      </DemoSection>

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
        <Specimen label="Switch field (label, optional line, click the label)" column>
          <SwitchField v-model="notify" label="Show finished to-dos" description="Done to-dos stay in the list, crossed out." data-testid="switch-field" :disabled="off" />
          <SwitchField v-model="quiet" label="Start on Home" :disabled="off" />
          <SwitchField :model-value="true" label="Locked by your admin" disabled />
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
        <Specimen label="Select with an empty choice (SelectItem value=&quot;&quot;)">
          <Select v-model="optional" :disabled="off">
            <SelectTrigger class="w-56" aria-label="Class" data-testid="select-empty">
              <SelectValue placeholder="Pick a class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">No class</SelectItem>
              <SelectItem value="warrior">Warrior</SelectItem>
              <SelectItem value="ranger">Ranger</SelectItem>
            </SelectContent>
          </Select>
          <span class="text-muted-foreground text-xs" data-testid="select-empty-value">Value: {{ optional === "" ? "(empty)" : optional }}</span>
        </Specimen>
        <Specimen label="Combobox (type to search)">
          <Combobox v-model="picked" :disabled="off">
            <ComboboxAnchor class="w-56">
              <ComboboxInput placeholder="Search games" aria-label="Game" />
            </ComboboxAnchor>
            <ComboboxList>
              <ComboboxEmpty>No game found</ComboboxEmpty>
              <ComboboxItem v-for="game in GAMES" :key="game" :value="game">{{ game }}</ComboboxItem>
            </ComboboxList>
          </Combobox>
          <span class="text-muted-foreground text-sm">{{ picked ?? "Nothing picked" }}</span>
        </Specimen>
        <Specimen label="Picker (a button with the list under it)">
          <Picker
            v-model="pickedGame"
            label="Game"
            :disabled="off"
            :options="[
              { value: 'satisfactory', label: 'Satisfactory' },
              { value: 'enshrouded', label: 'Enshrouded' },
              { value: 'poe2', label: 'Path of Exile 2' },
            ]"
          />
          <Picker v-model="pickedLanguage" label="Language" search="Search languages" empty="No language found" :disabled="off" :options="LANGUAGE_OPTIONS" />
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
        <Specimen label="Slider with its value (steps of 5)" column>
          <SliderField v-model="opacity" :min="0" :max="100" :step="5" unit="%" label="Opacity" class="max-w-56" :disabled="off" />
        </Specimen>
        <Specimen label="Number field (plus and minus, 1 to 99)" column>
          <NumberField v-model="copies" :min="1" :max="99" label="Copies" decrease-label="One less" increase-label="One more" :disabled="off" />
          <span class="text-muted-foreground text-xs tabular-nums">{{ copies }} copies</span>
        </Specimen>
        <Specimen label="Select with pictures" column>
          <Select v-model="style" :disabled="off">
            <SelectTrigger class="w-56" aria-label="Style"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in STYLES" :key="option.value" :value="option.value">
                <template #thumb><span class="bg-muted relative h-5 w-8 flex-none rounded-sm border" aria-hidden="true"><span class="bg-muted-foreground/70 absolute inset-x-1 top-1.5 h-1 rounded-full" /></span>
<DemoSection v-if="visible.has('toggles')" id="toggles" :title="title('toggles')" description="Buttons that stay pressed, such as Bold next to a text size. Tiles pick one look out of a few by its picture.">
        <Specimen label="Toggles (separate buttons)">
          <Toggle v-model="bold" label="Bold" class="font-bold" :disabled="off">B</Toggle>
          <Toggle v-model="italic" label="Italic" class="font-serif italic" :disabled="off">I</Toggle>
        </Specimen>
        <Specimen label="Toggle group (joined)">
          <ToggleGroup
            v-model="formats"
            label="Text style"
            :disabled="off"
            :options="[
              { value: 'bold', label: 'Bold', text: 'B' },
              { value: 'italic', label: 'Italic', text: 'I' },
              { value: 'underline', label: 'Underline', text: 'U' },
            ]"
          />
        </Specimen>
        <Specimen label="Style tiles" column>
          <StyleTiles v-model="style" label="Style" :options="STYLES" class="max-w-96" :disabled="off">
            <template #tile="{ option }">
              <span :class="['absolute inset-x-2 rounded-sm bg-black/70', option.value === 'card' ? 'top-2 bottom-2' : option.value === 'bar' ? 'bottom-2 h-2' : 'top-1/2 h-1 -translate-y-1/2 bg-black/40']" />
            </template>
          </StyleTiles>
        </Specimen>
      </DemoSection>
</template>
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('ratings')" id="ratings" :title="title('ratings')" description="Five stars. Shown, a rating rounds to the nearest half star; picked, it takes whole stars.">
        <Specimen label="Shown (4.7, 4.2 and 4.8)">
          <StarRating :model-value="4.7" label="4.7 out of 5 stars" />
          <StarRating :model-value="4.2" label="4.2 out of 5 stars" />
          <StarRating :model-value="4.8" label="4.8 out of 5 stars" />
        </Specimen>
        <Specimen label="Sizes">
          <StarRating :model-value="3.5" size="sm" label="3.5 out of 5 stars" />
          <StarRating :model-value="3.5" label="3.5 out of 5 stars" />
          <StarRating :model-value="3.5" size="lg" label="3.5 out of 5 stars" />
        </Specimen>
        <Specimen label="Pick a rating (arrow keys work too)">
          <StarRating v-model="stars" editable size="lg" label="Your rating" :star-label="(n) => (n === 1 ? '1 star' : `${n} stars`)" :disabled="off" />
          <span class="text-muted-foreground text-xs tabular-nums">{{ stars ? `${stars} of 5` : "Not rated" }}</span>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('colors')" id="colors" :title="title('colors')" description="Pick one colour from a few. Each swatch has a name for screen readers; arrow keys move between them.">
        <Specimen label="Swatches" column>
          <ColorPicker v-model="swatchColor" label="Colour" :colors="SWATCHES" :labels="SWATCH_NAMES" :disabled="off" />
        </Specimen>
        <Specimen label="With a custom colour" column>
          <ColorPicker v-model="swatchColor" label="Colour" :colors="SWATCHES" :labels="SWATCH_NAMES" allow-custom :disabled="off" />
          <span class="text-muted-foreground text-xs tabular-nums">{{ swatchColor }}</span>
        </Specimen>
      </DemoSection>
</template>
