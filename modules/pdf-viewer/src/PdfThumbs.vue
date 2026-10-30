<script setup lang="ts">
// Small pictures of every page, for jumping through a long PDF. A picture is drawn only while it is near the
// visible part of the list and let go again far from it, so a long PDF does not fill the memory. The page the
// reader is on is marked and kept in view.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { t } from "./i18n";
import type { PageSize } from "./layout";
import type { PDFDocumentProxy } from "./pdf";

/** How wide a picture is shown, in CSS pixels. */
const THUMB_WIDTH = 112;

const props = defineProps<{ pdf: PDFDocumentProxy; sizes: PageSize[]; page: number }>();
const emit = defineEmits<{ go: [page: number] }>();

const list = ref<HTMLElement | null>(null);
const drawn = new Map<number, { cancel: () => void } | null>();
let observer: IntersectionObserver | null = null;

const heightOf = (size: PageSize) => Math.round((THUMB_WIDTH * size.height) / Math.max(1, size.width));

async function draw(number: number, host: HTMLElement) {
  if (drawn.has(number)) return;
  drawn.set(number, null);
  try {
    const page = await props.pdf.getPage(number);
    if (!drawn.has(number)) return;
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (THUMB_WIDTH * ratio) / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    const task = page.render({ canvas, viewport });
    drawn.set(number, task);
    await task.promise;
    if (drawn.get(number) !== task) return;
    host.replaceChildren(canvas);
  } catch {
    // A page that cannot be drawn keeps its number only; the big view says what went wrong.
  }
}

function forget(number: number, host: HTMLElement) {
  if (!drawn.has(number)) return;
  drawn.get(number)?.cancel();
  drawn.delete(number);
  host.replaceChildren();
}

function observe() {
  observer?.disconnect();
  if (!list.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const number = Number(element.dataset.thumb);
        const host = element.querySelector<HTMLElement>("[data-thumb-host]");
        if (!host) continue;
        if (entry.isIntersecting) void draw(number, host);
        else forget(number, host);
      }
    },
    { root: list.value, rootMargin: "600px 0px" },
  );
  for (const element of list.value.querySelectorAll("[data-thumb]")) observer.observe(element);
}

/** Keeps the marked page in view without jumping when it already is. */
function reveal() {
  list.value?.querySelector(`[data-thumb="${props.page}"]`)?.scrollIntoView({ block: "nearest" });
}

onMounted(async () => {
  await nextTick();
  observe();
  reveal();
});

watch(() => props.page, reveal, { flush: "post" });

onBeforeUnmount(() => {
  observer?.disconnect();
  for (const task of drawn.values()) task?.cancel();
  drawn.clear();
});
</script>

<template>
  <nav ref="list" class="bg-card w-40 flex-none overflow-y-auto border-r p-2" :aria-label="t('pdf.pages')" data-testid="pdf-thumbs">
    <ol class="flex flex-col items-center gap-3">
      <li v-for="(size, index) in sizes" :key="index" :data-thumb="index + 1">
        <button
          type="button"
          class="group flex flex-col items-center gap-1 rounded-md p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          :aria-label="t('pdf.goToPage', { page: index + 1 })"
          :aria-current="index + 1 === page ? 'page' : undefined"
          data-testid="pdf-thumb"
          @click="emit('go', index + 1)"
        >
          <span
            data-thumb-host
            class="relative block overflow-hidden bg-white shadow-sm ring-offset-2 ring-offset-card transition-shadow group-hover:ring-2 group-hover:ring-border"
            :class="index + 1 === page ? 'ring-2 ring-primary group-hover:ring-primary' : ''"
            :style="{ width: `${THUMB_WIDTH}px`, height: `${heightOf(size)}px` }"
          />
          <span class="text-xs tabular-nums" :class="index + 1 === page ? 'text-foreground font-medium' : 'text-muted-foreground'">{{ index + 1 }}</span>
        </button>
      </li>
    </ol>
  </nav>
</template>
