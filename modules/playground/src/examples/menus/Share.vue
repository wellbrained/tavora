<script setup lang="ts">
// ShareMenu: a Share button with Copy as text, Copy as image and Save as image, toasts included. ShareMenuSub puts the
// same entries in a menu of your own, as a "Share" row. The picture is drawn with renderToImage when the menu opens.
import { MoreHorizontal, Pencil, Trash2 } from "@lucide/vue";
import { renderToImage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { ShareMenu, ShareMenuSub } from "@tavora/official-ui/components/ui/share-menu";
import { toast } from "@tavora/official-ui/components/ui/toast";

const text = () => "Solved Sudoku on Hard in 4:12 ⏱️";

/** A small card in the theme's colours: the result and the time. */
function image() {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(name).trim();
  // The theme's font: a canvas can't read var(--font-sans) itself.
  const label = `600 13px ${color("--font-sans")}`;
  const time = `700 40px ${color("--font-sans")}`;
  return renderToImage({
    width: 320,
    height: 120,
    fonts: [label, time],
    draw(ctx) {
      ctx.fillStyle = color("--card");
      ctx.beginPath();
      ctx.roundRect(0, 0, 320, 120, 12);
      ctx.fill();
      ctx.fillStyle = color("--muted-foreground");
      ctx.font = label;
      ctx.fillText("Sudoku · Hard", 24, 40);
      ctx.fillStyle = color("--primary");
      ctx.font = time;
      ctx.fillText("4:12", 24, 88);
    },
  });
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <ShareMenu :text="text" :image="image" name="Sudoku Hard" />
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button size="icon-sm" variant="ghost" aria-label="More" title="More"><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem @select="toast.success('Renamed')"><Pencil /> Rename</DropdownMenuItem>
        <ShareMenuSub :text="text" :image="image" name="Sudoku Hard" />
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><Trash2 /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
