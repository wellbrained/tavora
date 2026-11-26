<script setup lang="ts">
// A small picture of a style, drawn from its looks where styles differ most: the open tab, the main and the second
// button (with the status light), a field and a switch, on the style's surface, in its font and in the colours of its own
// theme. Settings > Appearance shows it in the Style list, the way ThemePreview shows a theme. Small (closed picker), it
// keeps only the tab and the buttons.
import { computed } from "vue";
import type { StyleView, ThemeVariationView } from "../../../shared/host-api";
import { fontFamily, uiFont } from "../../../shared/ui-fonts";

const props = defineProps<{ look: StyleView; size?: "sm" | "md"; variation?: ThemeVariationView }>();

const looks = computed(() => props.look.looks);
const md = computed(() => props.size === "md");
/** The style's corner, scaled down to the picture (Classic's comes from its theme). */
const corner = computed(() => {
  const radius = props.look.id === "tavora.classic" ? (props.variation?.radius ?? 8) : props.look.radius;
  return Math.round(radius * (md.value ? 0.55 : 0.4));
});
/** The theme's colours on the picture; without one it shows in the colours in use. */
const colours = computed(() => {
  const colors = props.variation?.colors;
  const vars: Record<string, string> = { "--sp-r": `${corner.value}px`, "--sp-font": fontFamily(uiFont(props.look.font)) };
  if (colors) {
    for (const token of ["background", "foreground", "card", "muted-foreground", "primary", "primary-foreground", "primary-fill", "primary-fill-foreground", "secondary", "secondary-foreground", "border", "info", "success"]) {
      if (colors[token]) vars[`--sp-${token}`] = colors[token]!;
    }
  }
  return vars;
});
const caps = computed(() => looks.value.labels === "caps-mono");
const word = (text: string) => (caps.value ? text.toUpperCase() : text);
</script>

<template>
  <div
    :class="['style-preview relative block flex-none overflow-hidden rounded-md border', md ? 'h-[76px] w-[132px]' : 'h-10 w-16']"
    :style="colours"
    :data-size="md ? 'md' : 'sm'"
    :data-surface="looks.surface"
    :data-content="looks.content"
    :data-tabs="looks.tabs"
    :data-buttons="looks.buttons"
    :data-inputs="looks.inputs"
    :data-labels="looks.labels"
    :data-status="looks.status"
    aria-hidden="true"
    data-testid="style-preview"
  >
    <span class="panel">
      <span class="tabs">
        <span class="tab on">{{ md ? word("Skills") : "" }}</span>
        <span class="tab">{{ md ? word("Gear") : "" }}</span>
      </span>
      <span class="body">
        <span class="row">
          <span class="btn main">{{ md ? word("Save") : "" }}</span>
          <span class="btn second">{{ md ? word("Undo") : "" }}</span>
          <span v-if="md" class="switch" />
        </span>
        <span v-if="md" class="field" />
      </span>
    </span>
  </div>
</template>

<style scoped>
.style-preview {
  --bg: var(--sp-background, var(--background));
  --fg: var(--sp-foreground, var(--foreground));
  --card-c: var(--sp-card, var(--card));
  --muted: var(--sp-muted-foreground, var(--muted-foreground));
  --accent-c: var(--sp-primary, var(--primary));
  /* A theme file may leave the fill out: then it is the accent, as in the app. */
  --fill: var(--sp-primary-fill, var(--sp-primary, var(--primary-fill)));
  --fill-fg: var(--sp-primary-fill-foreground, var(--sp-primary-foreground, var(--primary-fill-foreground)));
  --second: var(--sp-secondary, var(--secondary));
  --second-fg: var(--sp-secondary-foreground, var(--secondary-foreground));
  --line: var(--sp-border, var(--border));
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sp-font);
  font-size: 7.5px;
  font-weight: 600;
  line-height: 1;
}
.style-preview[data-surface="glass"] {
  background:
    radial-gradient(60% 70% at 10% 12%, color-mix(in srgb, var(--accent-c) 45%, transparent), transparent 70%),
    radial-gradient(60% 70% at 95% 95%, color-mix(in srgb, var(--sp-success, var(--success)) 35%, transparent), transparent 70%),
    var(--bg);
}
[data-labels="caps-mono"] {
  font-family: "Tavora JetBrains Mono", ui-monospace, monospace;
  font-size: 6.5px;
  letter-spacing: 0.04em;
}

/* The panel: flat, raised or glass. */
.panel {
  position: absolute;
  inset: 5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  border-radius: calc(var(--sp-r) + 2px);
  background: var(--card-c);
  border: 1px solid var(--line);
}
[data-size="sm"] .panel {
  inset: 4px;
  padding: 3px;
  gap: 3px;
}
[data-surface="raised"] .panel {
  background: linear-gradient(color-mix(in srgb, white 6%, var(--card-c)), var(--card-c));
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 14%, transparent), 0 1px 2px color-mix(in srgb, black 35%, transparent);
}
[data-surface="glass"] .panel {
  background: color-mix(in srgb, var(--card-c) 55%, transparent);
  border-color: color-mix(in srgb, white 22%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 25%, transparent);
}

/* Tabs: pill (Classic's underline, a soft groove elsewhere) or keycap. */
.tabs {
  display: flex;
  gap: 2px;
  align-items: center;
  align-self: flex-start;
}
.tab {
  display: block;
  padding: 2px 4px;
  color: var(--muted);
  border-radius: var(--sp-r);
}
[data-size="sm"] .tab {
  width: 13px;
  height: 5px;
  padding: 0;
  background: color-mix(in srgb, var(--fg) 14%, transparent);
}
.tab.on {
  color: var(--fg);
}
[data-tabs="pill"] .tab.on {
  border-radius: 0;
  box-shadow: inset 0 -1.5px 0 var(--accent-c);
}
.style-preview:not([data-surface="flat"])[data-tabs="pill"] .tabs {
  padding: 1px;
  border-radius: calc(var(--sp-r) + 1px);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}
.style-preview:not([data-surface="flat"])[data-tabs="pill"] .tab.on {
  border-radius: var(--sp-r);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 18%, transparent);
  background: color-mix(in srgb, var(--fg) 18%, transparent);
}
[data-tabs="keycap"] .tab {
  border-radius: max(1px, calc(var(--sp-r) / 2));
}
[data-tabs="keycap"] .tab.on {
  background: var(--fg);
  color: var(--bg);
  box-shadow: 0 1px 0 color-mix(in srgb, black 40%, transparent);
}

/* The content: plain, or an inset screen. */
.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 4px;
  min-height: 0;
}
[data-content="inset"] .body {
  padding: 3px;
  border-radius: max(1px, calc(var(--sp-r) / 2));
  /* A dark screen in light and dark, as inset content gets the theme's dark colours. */
  background: color-mix(in srgb, black 82%, var(--bg));
  box-shadow: inset 0 1px 2px color-mix(in srgb, black 60%, transparent);
}
.style-preview[data-content="inset"] .field {
  background: color-mix(in srgb, white 6%, black);
  border-color: color-mix(in srgb, white 14%, transparent);
}
.style-preview[data-content="inset"] .switch {
  background: color-mix(in srgb, white 6%, black);
}
.row {
  display: flex;
  gap: 3px;
  align-items: center;
}

/* Buttons: soft, keycap (with the status light) or capsule. */
.btn {
  display: block;
  position: relative;
  padding: 2.5px 5px;
  border-radius: var(--sp-r);
}
[data-size="sm"] .btn {
  width: 16px;
  height: 7px;
  padding: 0;
}
.btn.main {
  background: var(--fill);
  color: var(--fill-fg);
}
.btn.second {
  background: var(--second);
  color: var(--second-fg);
}
[data-buttons="keycap"] .btn {
  border-radius: max(1px, calc(var(--sp-r) / 2));
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 14%, transparent), 0 1.5px 0 color-mix(in srgb, black 55%, transparent);
}
[data-buttons="capsule"] .btn.second {
  background: color-mix(in srgb, var(--fg) 12%, transparent);
  color: var(--fg);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 15%, transparent);
}
[data-status="led"] .btn.main {
  padding-left: 9px;
}
[data-size="sm"][data-status="led"] .btn.main {
  padding-left: 0;
}
[data-status="led"] .btn.main::before {
  content: "";
  position: absolute;
  left: 3.5px;
  top: 50%;
  width: 2.5px;
  height: 2.5px;
  margin-top: -1.25px;
  border-radius: 50%;
  background: var(--accent-c);
  box-shadow: 0 0 3px var(--accent-c);
}

/* Fields and switches: soft, inset or capsule. */
.field {
  display: block;
  height: 9px;
  border-radius: var(--sp-r);
  border: 1px solid var(--line);
  background: var(--bg);
}
[data-inputs="inset"] .field {
  border-radius: max(1px, calc(var(--sp-r) / 2));
  background: color-mix(in srgb, black 25%, var(--bg));
  box-shadow: inset 0 1px 1.5px color-mix(in srgb, black 55%, transparent);
}
[data-inputs="capsule"] .field {
  border-color: transparent;
  background: color-mix(in srgb, var(--fg) 10%, transparent);
}
.switch {
  display: block;
  position: relative;
  margin-left: auto;
  width: 13px;
  height: 7px;
  border-radius: 4px;
  background: var(--accent-c);
}
.switch::after {
  content: "";
  position: absolute;
  top: 1.5px;
  right: 1.5px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--bg);
}
[data-inputs="inset"] .switch {
  border-radius: 1px;
  background: color-mix(in srgb, black 25%, var(--bg));
  box-shadow: inset 0 1px 1.5px color-mix(in srgb, black 55%, transparent);
}
[data-inputs="inset"] .switch::after {
  border-radius: 1px;
  background: var(--accent-c);
  box-shadow: 0 0 3px var(--accent-c);
}
[data-inputs="capsule"] .switch::after {
  background: white;
}
</style>
