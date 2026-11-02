<script setup lang="ts">
// The menu on the left of a module's settings: the module's own pages, then Overlays under a divider heading with how the overlay
// looks first (Text, Look) and where it shows after (In game, On stream), each with a dot.
import { Keyboard, Music, Paintbrush, Type } from "@lucide/vue";
import { NavList } from "@tavora/official-ui/components/ui/nav-list";
import { settingsMenu } from "@tavora/official-ui/components/ui/module-settings";
import { ref } from "vue";

const page = ref("text");
const groups = settingsMenu({
  pages: [{ id: "player", label: "Player", icon: Music }, { id: "hotkeys", label: "Hotkeys", icon: Keyboard }],
  look: [{ id: "text", label: "Text", icon: Type }, { id: "look", label: "Look", icon: Paintbrush }],
  inGame: { id: "game", on: true },
  onStream: { id: "stream", on: false },
});
</script>

<template>
  <NavList v-model="page" :groups="groups" label="Settings" class="bg-background w-[200px] rounded-lg border p-3" />
</template>
