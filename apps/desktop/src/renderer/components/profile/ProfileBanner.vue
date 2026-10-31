<script setup lang="ts">
// One banner behind the picture in the profile dialog, filling its box: a pattern or a scene drawn in the theme's
// colours (so it follows a theme change), or the user's picture blurred. The scenes keep their main shape to the right,
// because the picture overlaps the banner's lower left. Also the thumbnails in BannerPicker.vue.
import { computed, useId } from "vue";
import type { ProfileBanner } from "../../../shared/profile-banner";

const props = defineProps<{ banner: ProfileBanner; pictureUrl: string | null }>();

const SCENES = ["night-camp", "forest", "mountains", "map"] as const;
const scene = computed(() => ((SCENES as readonly string[]).includes(props.banner) ? props.banner : null));
/** The picture banner without a picture falls back to stripes. */
const pattern = computed(() => (props.banner === "picture" && !props.pictureUrl ? "stripes" : props.banner));
/** Gradients are looked up by id, so each banner on the page needs its own. */
const id = useId();

/** The theme's accent mixed into its background. */
const mix = (pct: number, with2 = false) => `color-mix(in srgb, var(${with2 ? "--banner-2" : "--primary"}) ${pct}%, var(--background))`;

// Stars at fixed, scattered spots in the sky to the right of the picture.
function stars(count: number, seed: number) {
  const out: { x: number; y: number; r: number; o: number }[] = [];
  let r = seed;
  const next = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < count; i++) out.push({ x: 110 + next() * 185, y: 4 + next() * 50, r: 0.4 + next() * 0.9, o: 0.35 + next() * 0.5 });
  return out;
}
const SKY = { "night-camp": stars(30, 3), forest: stars(18, 11) } as const;
const PINES = [
  [110, 70, 1],
  [130, 60, 1.3],
  [152, 72, 0.9],
  [232, 64, 1.2],
  [258, 56, 1.4],
  [282, 70, 1],
] as const;
const FLAME = "M0 0 C-11 -5 -10 -18 -3 -31 C-2 -23 3 -21 5 -15 C8 -19 7 -25 5 -29 C13 -20 12 -6 0 0Z";
const SPARKS = [
  [-6, -44, 1.4],
  [5, -52, 1],
  [-1, -62, 0.8],
  [9, -40, 1.1],
  [-10, -56, 0.7],
] as const;
/** A small fire at x, y (its foot) and scale s. */
const fire = (x: number, y: number, s: number) => ({ x, y, s });
const FIRES = { "night-camp": fire(236, 90, 0.62), forest: fire(196, 96, 0.55) } as const;
</script>

<template>
  <div :class="['banner-root relative size-full overflow-hidden', !scene && `banner-${pattern}`]" :data-banner="banner">
    <img v-if="pattern === 'picture'" :src="pictureUrl!" alt="" class="absolute inset-0 size-full scale-150 object-cover blur-xl brightness-[0.55] saturate-150" />
    <svg v-else-if="scene" class="absolute inset-0 size-full" viewBox="0 0 300 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient :id="`${id}-glow`">
          <stop offset="0" class="b-glow-in" />
          <stop offset="1" class="b-glow-out" />
        </radialGradient>
        <linearGradient :id="`${id}-sky`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="b-sky-top" />
          <stop offset="1" :style="{ stopColor: mix(22) }" />
        </linearGradient>
        <linearGradient :id="`${id}-night`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :style="{ stopColor: mix(14, true) }" />
          <stop offset="1" :style="{ stopColor: mix(10) }" />
        </linearGradient>
      </defs>

      <template v-if="scene === 'night-camp' || scene === 'forest'">
        <rect width="300" height="100" :fill="`url(#${id}-night)`" />
        <circle v-for="(star, index) in SKY[scene]" :key="index" :cx="star.x" :cy="star.y" :r="star.r" :style="{ fill: 'var(--foreground)', opacity: star.o }" />
      </template>
      <template v-if="scene === 'night-camp'">
        <path d="M268 14 a10 10 0 1 0 8 16 a8 8 0 1 1 -8 -16z" class="b-moon" />
        <path d="M0 80 Q60 58 130 74 T300 66 V100 H0Z" :style="{ fill: mix(14) }" />
        <path d="M0 92 Q90 78 180 88 T300 84 V100 H0Z" :style="{ fill: mix(8) }" />
        <path d="M168 90 L186 62 L204 90Z" :style="{ fill: mix(40, true) }" />
        <path d="M186 62 L190 90 L182 90Z" :style="{ fill: mix(20, true) }" />
      </template>
      <template v-if="scene === 'forest'">
        <path
          v-for="([x, y, s], index) in PINES"
          :key="index"
          :transform="`translate(${x} ${y}) scale(${s})`"
          d="M0 -26 L10 -8 L5 -8 L13 6 L6 6 L15 22 L-15 22 L-6 6 L-13 6 L-5 -8 L-10 -8Z"
          :style="{ fill: mix(22) }"
        />
        <rect y="92" width="300" height="8" :style="{ fill: mix(10) }" />
      </template>
      <!-- The fire: glow, two crossed logs, three flames and a few sparks. -->
      <g v-if="scene === 'night-camp' || scene === 'forest'">
        <ellipse :cx="FIRES[scene].x" :cy="FIRES[scene].y - 6 * FIRES[scene].s" :rx="46 * FIRES[scene].s" :ry="30 * FIRES[scene].s" :fill="`url(#${id}-glow)`" />
        <rect
          v-for="(angle, index) in [14, -14]"
          :key="index"
          :x="FIRES[scene].x - 17 * FIRES[scene].s"
          :y="FIRES[scene].y - 5 * FIRES[scene].s"
          :width="34 * FIRES[scene].s"
          :height="5 * FIRES[scene].s"
          :rx="2.5 * FIRES[scene].s"
          :transform="`rotate(${angle} ${FIRES[scene].x} ${FIRES[scene].y})`"
          :style="{ fill: mix(index ? 35 : 45, true) }"
        />
        <path :d="FLAME" :transform="`translate(${FIRES[scene].x} ${FIRES[scene].y - 3 * FIRES[scene].s}) scale(${1.15 * FIRES[scene].s})`" class="b-flame-outer" />
        <path :d="FLAME" :transform="`translate(${FIRES[scene].x + 2 * FIRES[scene].s} ${FIRES[scene].y - 3 * FIRES[scene].s}) scale(${0.8 * FIRES[scene].s})`" class="b-accent" />
        <path :d="FLAME" :transform="`translate(${FIRES[scene].x + FIRES[scene].s} ${FIRES[scene].y - 3 * FIRES[scene].s}) scale(${0.42 * FIRES[scene].s})`" class="b-flame-core" />
        <circle
          v-for="([dx, dy, r], index) in SPARKS"
          :key="index"
          :cx="FIRES[scene].x + dx * FIRES[scene].s"
          :cy="FIRES[scene].y + dy * FIRES[scene].s"
          :r="r * FIRES[scene].s"
          class="b-spark"
        />
      </g>

      <template v-if="scene === 'mountains'">
        <rect width="300" height="100" :fill="`url(#${id}-sky)`" />
        <circle cx="215" cy="44" r="16" class="b-sun" />
        <path d="M0 70 L40 38 L80 62 L130 22 L180 64 L230 34 L300 70 V100 H0Z" :style="{ fill: mix(26) }" />
        <path d="M0 84 L60 56 L110 80 L170 48 L230 82 L270 62 L300 74 V100 H0Z" :style="{ fill: mix(16) }" />
        <path d="M0 100 L0 90 Q150 80 300 92 V100Z" :style="{ fill: mix(8) }" />
      </template>

      <template v-if="scene === 'map'">
        <rect width="300" height="100" :style="{ fill: mix(18) }" />
        <ellipse v-for="ring in 5" :key="ring" cx="225" cy="64" :rx="2 + ring * 16" :ry="1 + ring * 9" :style="{ fill: 'none', stroke: mix(30), strokeWidth: 1 }" />
        <path d="M100 82 C140 40 170 90 205 52 S250 30 256 36" class="b-trail" />
        <path d="M252 30 l12 12 M264 30 l-12 12" class="b-x" />
        <g transform="translate(150 22)" class="b-compass">
          <circle r="11" class="b-ring" />
          <path d="M0 -14 L3 0 L0 14 L-3 0Z" class="b-accent" />
        </g>
      </template>
    </svg>
  </div>
</template>

<style scoped>
/* A second colour beside the theme's accent, turned a little around the colour wheel (logs, tent, the X on the map). */
.banner-root {
  --banner-2: oklch(from var(--primary) l c calc(h - 40));
  background-color: var(--background);
}
.banner-stripes {
  background:
    repeating-linear-gradient(135deg, color-mix(in srgb, var(--primary) 16%, transparent) 0 2px, transparent 2px 12px),
    linear-gradient(135deg, color-mix(in srgb, var(--primary) 45%, var(--background)), color-mix(in srgb, var(--primary) 12%, var(--background)));
}
.banner-crosshatch {
  background:
    repeating-linear-gradient(45deg, color-mix(in srgb, var(--primary) 14%, transparent) 0 1px, transparent 1px 8px),
    repeating-linear-gradient(-45deg, color-mix(in srgb, var(--primary) 14%, transparent) 0 1px, transparent 1px 8px),
    linear-gradient(160deg, color-mix(in srgb, var(--primary) 34%, var(--background)), color-mix(in srgb, var(--primary) 10%, var(--background)));
}
.banner-sunburst {
  background: repeating-conic-gradient(
    from 0deg at 15% 120%,
    color-mix(in srgb, var(--primary) 24%, var(--background)) 0 6deg,
    color-mix(in srgb, var(--primary) 12%, var(--background)) 6deg 12deg
  );
}
.banner-dots {
  background:
    radial-gradient(circle, color-mix(in srgb, var(--primary) 50%, transparent) 1.4px, transparent 1.8px) 0 0 / 12px 12px,
    linear-gradient(160deg, color-mix(in srgb, var(--primary) 32%, var(--background)), color-mix(in srgb, var(--primary) 8%, var(--background)));
}
.banner-checks {
  background: conic-gradient(
      color-mix(in srgb, var(--primary) 24%, var(--background)) 25%,
      color-mix(in srgb, var(--primary) 12%, var(--background)) 0 50%,
      color-mix(in srgb, var(--primary) 24%, var(--background)) 0 75%,
      color-mix(in srgb, var(--primary) 12%, var(--background)) 0
    )
    0 0 / 12px 12px;
}
.banner-rings {
  background:
    repeating-radial-gradient(circle at 85% 120%, transparent 0 9px, color-mix(in srgb, var(--primary) 32%, transparent) 9px 10.5px),
    linear-gradient(160deg, color-mix(in srgb, var(--primary) 30%, var(--background)), color-mix(in srgb, var(--primary) 8%, var(--background)));
}
/* The scenes' fixed colours live here: the host allows no inline style attributes, and Vue writes fixed SVG parts as
   plain markup. */
.b-glow-in {
  stop-color: var(--primary);
  stop-opacity: 0.45;
}
.b-glow-out {
  stop-color: var(--primary);
  stop-opacity: 0;
}
.b-sky-top {
  stop-color: var(--background);
}
.b-moon {
  fill: var(--foreground);
  opacity: 0.85;
}
.b-flame-outer {
  fill: color-mix(in srgb, var(--banner-2) 85%, transparent);
}
.b-accent {
  fill: var(--primary);
}
.b-flame-core {
  fill: color-mix(in srgb, var(--primary) 40%, #fff);
}
.b-spark {
  fill: var(--primary);
  opacity: 0.8;
}
.b-sun {
  fill: var(--primary);
  opacity: 0.55;
}
.b-trail {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2;
  stroke-dasharray: 5 5;
  opacity: 0.85;
}
.b-x {
  stroke: var(--banner-2);
  stroke-width: 3;
  stroke-linecap: round;
}
.b-compass {
  opacity: 0.7;
}
.b-ring {
  fill: none;
  stroke: var(--primary);
  stroke-width: 1;
}
</style>
