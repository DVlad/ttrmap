<template>
  <div class="relative">
    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      class="w-full"
      role="img"
      :aria-label="t('map.profile.chartLabel')"
      @mousemove="onMove"
      @mouseleave="hoverIndex = null"
    >
      <!-- Grila: doar liniile de sus și de jos, ca reper. -->
      <line :x1="0" :y1="PAD" :x2="WIDTH" :y2="PAD" stroke="#374151" stroke-width="0.5" />
      <line
        :x1="0"
        :y1="HEIGHT - PAD"
        :x2="WIDTH"
        :y2="HEIGHT - PAD"
        stroke="#374151"
        stroke-width="0.5"
      />

      <path v-if="areaPath" :d="areaPath" fill="#c98a3e" opacity="0.25" />
      <path v-if="linePath" :d="linePath" fill="none" stroke="#d3974a" stroke-width="1.5" />

      <!-- Indicatorul de hover -->
      <g v-if="hoverPoint">
        <line
          :x1="hoverX"
          :y1="PAD"
          :x2="hoverX"
          :y2="HEIGHT - PAD"
          stroke="#9ca3af"
          stroke-width="0.5"
          stroke-dasharray="2 2"
        />
        <circle :cx="hoverX" :cy="hoverY" r="2.5" fill="#ffffff" stroke="#d3974a" stroke-width="1" />
      </g>
    </svg>

    <div class="mt-1 flex justify-between text-[10px] text-gray-500">
      <span>{{ Math.round(minElevationM) }} m</span>
      <span v-if="hoverPoint" class="text-gray-300">
        {{ (hoverPoint.distanceM / 1000).toFixed(1) }} km ·
        {{ Math.round(hoverPoint.elevationM) }} m
      </span>
      <span>{{ Math.round(maxElevationM) }} m</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ProfilePoint } from "@/utils/elevationProfile";

/**
 * Profilul altimetric al traseului planificat.
 *
 * Desenat direct în SVG, fără bibliotecă de grafice: sînt două linii și un polígon, iar o dependență
 * de diagrame ar cîntări cît toată harta. Coordonatele se calculează din min/max, deci graficul se
 * întinde pe verticală oricît de mică ar fi diferența de nivel — un traseu de 30 m urcat arată la fel
 * de lizibil ca unul de 1 500 m.
 */

const props = defineProps<{
  points: ProfilePoint[];
  minElevationM: number;
  maxElevationM: number;
  totalDistanceM: number;
}>();

const { t } = useI18n();

const WIDTH = 300;
const HEIGHT = 80;
const PAD = 6;

const hoverIndex = ref<number | null>(null);

/** Diferența de nivel, cu un minim ca un traseu plat să nu împartă la zero. */
const span = computed(() => Math.max(props.maxElevationM - props.minElevationM, 1));

function xFor(distanceM: number): number {
  const total = props.totalDistanceM > 0 ? props.totalDistanceM : 1;
  return (distanceM / total) * WIDTH;
}

function yFor(elevationM: number): number {
  const ratio = (elevationM - props.minElevationM) / span.value;
  return HEIGHT - PAD - ratio * (HEIGHT - 2 * PAD);
}

const linePath = computed(() => {
  if (props.points.length < 2) return "";
  return props.points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xFor(point.distanceM).toFixed(2)},${yFor(point.elevationM).toFixed(2)}`)
    .join(" ");
});

const areaPath = computed(() => {
  if (props.points.length < 2) return "";
  const first = props.points[0]!;
  const last = props.points[props.points.length - 1]!;
  return `${linePath.value} L${xFor(last.distanceM).toFixed(2)},${HEIGHT - PAD} L${xFor(first.distanceM).toFixed(2)},${HEIGHT - PAD} Z`;
});

const hoverPoint = computed(() =>
  hoverIndex.value === null ? null : (props.points[hoverIndex.value] ?? null),
);

const hoverX = computed(() => (hoverPoint.value ? xFor(hoverPoint.value.distanceM) : 0));
const hoverY = computed(() => (hoverPoint.value ? yFor(hoverPoint.value.elevationM) : 0));

function onMove(event: MouseEvent) {
  if (props.points.length === 0) return;

  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  if (rect.width <= 0) return;

  const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  const target = ratio * (props.totalDistanceM > 0 ? props.totalDistanceM : 1);

  // Cel mai apropiat punct de poziția cursorului — seria are cel mult 100 de puncte.
  let best = 0;
  let bestDistance = Infinity;
  props.points.forEach((point, index) => {
    const delta = Math.abs(point.distanceM - target);
    if (delta < bestDistance) {
      bestDistance = delta;
      best = index;
    }
  });

  hoverIndex.value = best;
}
</script>
