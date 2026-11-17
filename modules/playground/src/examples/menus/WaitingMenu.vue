<script setup lang="ts">
// A row whose `action` returns a Promise: the menu stays open and the row pulses until it is done, then the menu
// closes. A failure shows the kit's error toast. Rename answers at once, like `@select`.
import { Copy, MoreHorizontal, Pencil, RefreshCw } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { toast } from "@tavora/official-ui/components/ui/toast";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function copy() {
  await pause(1500);
  toast.success("Copied");
}

async function reload() {
  await pause(1500);
  throw new Error("Can't reach the folder.");
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="secondary"><MoreHorizontal /> Board</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-56">
      <DropdownMenuItem :action="copy"><Copy /> Copy as picture</DropdownMenuItem>
      <DropdownMenuItem :action="reload"><RefreshCw /> Reload</DropdownMenuItem>
      <DropdownMenuItem :action="() => toast.success('Renamed')"><Pencil /> Rename</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
