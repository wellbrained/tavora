<script setup lang="ts">
import { THEME_TOKENS } from "@tavora/sdk";
import DemoSection from "../DemoSection.vue";
import Specimen from "../Specimen.vue";
import { type SectionId, sectionTitle as title } from "../sections";

defineProps<{ visible: Set<SectionId>; off: boolean; tokens: Record<string, string> }>();
</script>

<template>
<DemoSection v-if="visible.has('colours')" id="colours" :title="title('colours')" description="The theme tokens every module receives, with their current values.">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          <div v-for="name in THEME_TOKENS" :key="name" class="flex items-center gap-2 rounded-md border p-1.5">
            <span class="size-7 flex-none rounded-sm border" :style="{ background: `var(--${name})` }" />
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-mono text-xs">{{ name }}</span>
              <span class="text-muted-foreground truncate font-mono text-xs">{{ tokens[name] }}</span>
            </span>
          </div>
        </div>
        <Specimen label="Radius">
          <span class="bg-secondary size-10 rounded-sm" title="rounded-sm" />
          <span class="bg-secondary size-10 rounded-md" title="rounded-md" />
          <span class="bg-secondary size-10 rounded-lg" title="rounded-lg" />
          <span class="bg-secondary size-10 rounded-xl" title="rounded-xl" />
          <span class="text-muted-foreground font-mono text-xs">--radius: {{ tokens.radius }}</span>
        </Specimen>
      </DemoSection>

<DemoSection v-if="visible.has('type')" id="type" :title="title('type')" description="Inter for the interface, JetBrains Mono for code and ids. Nothing is smaller than 12 px.">
        <div class="flex flex-col gap-3">
          <div>
            <p class="text-3xl leading-[34px] font-semibold">Welcome back</p>
            <p class="text-muted-foreground text-xs">Display · 28 / 34 · 600</p>
          </div>
          <div>
            <p class="text-xl font-semibold">Page or dialog title</p>
            <p class="text-muted-foreground text-xs">Title · 20 / 26 · 600</p>
          </div>
          <div>
            <p class="text-lg font-semibold">Section heading</p>
            <p class="text-muted-foreground text-xs">Heading · 16 / 22 · 600</p>
          </div>
          <div>
            <p class="text-base">Body text for notes, lists and inputs. It should read comfortably at arm's length on a second monitor.</p>
            <p class="text-muted-foreground text-xs">Body · 14 / 20 · 400</p>
          </div>
          <div>
            <p class="text-sm font-medium">Compact text for menus, buttons and panel headers</p>
            <p class="text-muted-foreground text-xs">Compact · 13 / 18 · 500</p>
          </div>
          <div>
            <p class="text-muted-foreground text-xs">Caption for hints, timestamps and labels</p>
            <p class="text-muted-foreground text-xs">Caption · 12 / 16 · 400</p>
          </div>
        </div>
        <Specimen label="Mono, tabular numbers and links" column>
          <code class="bg-secondary w-fit rounded-sm px-1.5 py-0.5 font-mono text-sm">tavora.playground</code>
          <p class="text-sm tabular-nums">Timer 01:07:42 · 1,111 kills · 98.6%</p>
          <p class="text-sm">Read the <a href="#type" class="text-primary underline-offset-4 hover:underline">style guide</a> before adding colours.</p>
        </Specimen>
      </DemoSection>
</template>
