<script setup lang="ts">
// Areas are told apart by a surface step and a 1 px border. A shadow belongs to layers that float (menus, popovers,
// dialogs); the kit's Primary and Secondary buttons also get a faint top light.
import { Button } from "@tavora/official-ui/components/ui/button";
import { t } from "../../i18n";
</script>

<template>
  <div class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
    <figure class="flex flex-col gap-2">
      <div class="bg-card flex h-20 items-center justify-center rounded-lg border text-sm">Card</div>
      <figcaption class="text-muted-foreground text-xs"><code class="font-mono">bg-card border</code><br />{{ t("demo.depth.area") }}</figcaption>
    </figure>
    <figure class="flex flex-col gap-2">
      <div class="bg-popover text-popover-foreground flex h-20 items-center justify-center rounded-md border text-sm shadow-md">Menu</div>
      <figcaption class="text-muted-foreground text-xs"><code class="font-mono">bg-popover border shadow-md</code><br />{{ t("demo.depth.floating") }}</figcaption>
    </figure>
    <figure class="flex flex-col gap-2">
      <div class="flex h-20 items-center justify-center gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
      </div>
      <figcaption class="text-muted-foreground text-xs"><code class="font-mono">Button</code><br />{{ t("demo.depth.buttons") }}</figcaption>
    </figure>
  </div>
</template>
