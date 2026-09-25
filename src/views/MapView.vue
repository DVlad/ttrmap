<template>
  <div class="flex h-[calc(100vh-65px)]">
    <!-- Sidebar -->
    <aside class="w-72 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden shrink-0">
      <div class="p-4 border-b border-gray-800">
        <h1 class="text-lg font-bold text-white">{{ t("map.title") }}</h1>
        <p class="text-xs text-gray-500 mt-0.5">{{ t("map.zoomHint") }}</p>
      </div>

      <!-- Căutare: în baza noastră, nu într-un geocoder extern — „Cabana Omu" se găsește fără să
           știi în ce parte a țării e, iar rezultatul te duce acolo. -->
      <div class="p-3 border-b border-gray-800">
        <input
          v-model="searchQuery"
          type="search"
          :aria-label="t('map.search.label')"
          :placeholder="t('map.search.placeholder')"
          class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
          @input="onSearchInput"
        />

        <p v-if="searchError" class="mt-1.5 text-xs text-red-400">{{ searchError }}</p>
        <p v-else-if="searchLoading" class="mt-1.5 text-xs text-gray-500 animate-pulse">
          {{ t("map.poi.loading") }}
        </p>
        <ul v-else-if="searchResults.length > 0" class="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          <li v-for="result in searchResults" :key="result.id">
            <button
              class="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-800"
              @click="goToPoi(result)"
            >
              <span class="block truncate text-sm text-white">
                {{ result.name || t(`map.poi.${result.category}`) }}
              </span>
              <span class="block text-xs text-gray-500">
                {{ t(`map.poi.${result.category}`) }}
                <template v-if="result.elevationM !== null">
                  · {{ Math.round(result.elevationM) }} m
                </template>
              </span>
            </button>
          </li>
        </ul>
        <p
          v-else-if="searchQuery.trim().length >= MIN_POI_SEARCH_LENGTH"
          class="mt-1.5 text-xs text-gray-600"
        >
          {{ t("map.search.empty") }}
        </p>
      </div>

      <!-- Stilul hărții -->
      <div class="p-3 border-b border-gray-800">
        <p class="text-xs text-gray-500 uppercase tracking-wide mb-2">{{ t("map.mapStyle") }}</p>
        <div class="flex flex-col gap-1">
          <button
            v-for="style in MAP_STYLES"
            :key="style.key"
            class="text-left px-3 py-1.5 rounded-lg text-xs transition-colors"
            :class="
              activeStyle === style.key
                ? 'bg-orange-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            "
            @click="switchStyle(style.key)"
          >
            {{ t(style.labelKey) }}
          </button>
        </div>
      </div>

      <div class="p-3 border-b border-gray-800 space-y-2">
        <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">{{ t("map.routeTypes") }}</p>
        <label v-for="ft in TRAIL_FILTERS" :key="ft.key" class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            v-model="activeFilters"
            :value="ft.key"
            class="accent-orange-500"
            @change="onTrailFiltersChanged"
          />
          <span class="w-3 h-3 rounded-full shrink-0" :style="{ background: ft.color }" />
          <span class="text-sm text-gray-300">{{ t(ft.labelKey) }}</span>
        </label>
      </div>

      <!-- Puncte montane: citite din baza noastră, nu din Overpass (vezi mountainPoisApi.ts). -->
      <div class="p-3 border-b border-gray-800 space-y-2">
        <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">{{ t("map.poi.title") }}</p>
        <label
          v-for="category in POI_TOGGLE_CATEGORIES"
          :key="category"
          class="flex items-center gap-2 cursor-pointer"
        >
          <input
            v-model="activePoiCategories"
            type="checkbox"
            :value="category"
            class="accent-orange-500"
            @change="refreshPoiLayer"
          />
          <span
            class="w-3 h-3 rounded-full shrink-0"
            :style="{ background: poiColor(category) }"
          />
          <span class="text-sm text-gray-300">{{ t(`map.poi.${category}`) }}</span>
        </label>

        <p v-if="poiLoading" class="text-xs text-gray-500 animate-pulse">
          {{ t("map.poi.loading") }}
        </p>
        <p v-else-if="poiError" class="text-xs text-red-400">{{ poiError }}</p>
        <p v-else-if="poiLoaded && mountainPois.length === 0" class="text-xs text-gray-600">
          {{ t("map.poi.empty") }}
        </p>
      </div>

      <!-- Rutele mele -->
      <div class="px-3 pt-3 pb-1">
        <p class="text-xs text-gray-500 uppercase tracking-wide">{{ t("map.myRoutes") }}</p>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="routesStore.isLoading" class="p-4 text-gray-500 text-sm">{{ t("map.loading") }}</div>

        <div v-else-if="routes.length === 0" class="p-4 text-gray-500 text-sm">
          {{ t("map.noRoutes") }}
        </div>

        <ul v-else class="divide-y divide-gray-800">
          <li
            v-for="(route, idx) in routes"
            :key="route.id ?? idx"
            class="px-4 py-3 cursor-pointer hover:bg-gray-800 transition-colors"
            :class="{ 'bg-orange-500/10 border-l-2 border-orange-500': activeIdx === idx }"
            @click="focusRoute(idx)"
          >
            <p class="text-sm font-medium text-white truncate">{{ route.name }}</p>
            <p class="text-xs text-gray-500 mt-0.5">
              {{ (route.totalDistanceMeters / 1000).toFixed(1) }} km ·
              {{ Math.round(route.elevationGainMeters) }} m D+
            </p>
          </li>
        </ul>
      </div>

      <!-- Status Overpass -->
      <div class="p-3 border-t border-gray-800">
        <p v-if="osmLoading" class="text-xs text-orange-400 text-center animate-pulse">
          {{ t("map.osmLoading") }}
        </p>
        <p v-else-if="osmError" class="text-xs text-red-400 text-center">{{ osmError }}</p>
        <p v-else-if="osmCount > 0" class="text-xs text-gray-500 text-center">
          {{ t("map.osmSegments", { count: osmCount }) }}
        </p>
        <p v-else class="text-xs text-gray-600 text-center">
          {{ zoomTooLow ? t("map.zoomTooLow") : t("map.noTrails") }}
        </p>
      </div>

      <!-- Planner traseu -->
      <div class="p-3 border-t border-gray-800">
        <button
          class="w-full py-2 rounded-lg text-sm font-medium transition-colors"
          :class="
            plannerActive ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          "
          @click="togglePlanner"
        >
          {{ plannerActive ? t("map.plannerActive") : t("map.planRoute") }}
        </button>

        <div v-if="plannerActive" class="mt-2 space-y-2">
          <p class="text-xs text-gray-500">
            {{
              plannerWaypoints.length === 0
                ? t("map.plannerFirstPoint")
                : t("map.points", { count: plannerWaypoints.length })
            }}
          </p>

          <!-- Statistici: distanța și, cînd DEM-ul răspunde, D+/D−. Altitudinea lipsă se spune,
               nu se înlocuiește cu zero — regula din `docs/STUDY-MAP.md` §3.1.1. -->
          <div v-if="plannerWaypoints.length >= 2" class="bg-gray-800 rounded-lg p-2 space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-gray-400">{{ t("map.distance") }}</span>
              <span class="text-white font-medium">{{ (plannerDistance / 1000).toFixed(2) }} km</span>
            </div>
            <div v-if="plannerElevGain !== null" class="flex justify-between text-xs">
              <span class="text-gray-400">{{ t("map.gain") }}</span>
              <span class="text-emerald-400 font-medium">{{ Math.round(plannerElevGain) }} m</span>
            </div>
            <div v-if="plannerElevLoss !== null" class="flex justify-between text-xs">
              <span class="text-gray-400">{{ t("map.loss") }}</span>
              <span class="text-blue-400 font-medium">{{ Math.round(plannerElevLoss) }} m</span>
            </div>
            <p v-if="plannerElevLoading" class="text-xs text-gray-500 text-center animate-pulse">
              {{ t("map.calculatingElevation") }}
            </p>
            <p v-else-if="plannerElevGain === null" class="text-[11px] leading-snug text-gray-500">
              {{ t("map.elevationUnavailable") }}
            </p>
            <div v-else class="flex justify-between text-xs">
              <span class="text-gray-400">{{ t("map.profile.estimated") }}</span>
              <span class="text-white font-medium">{{ plannerDurationLabel }}</span>
            </div>
          </div>

          <!-- Profilul altimetric: ce lipsea ca planificatorul să spună ce te așteaptă. -->
          <div v-if="plannerProfile" class="space-y-1">
            <p class="text-[10px] uppercase tracking-wide text-gray-500">
              {{ t("map.profile.title") }}
            </p>
            <ElevationProfileChart
              :points="plannerProfile.points"
              :min-elevation-m="plannerProfile.minElevationM ?? 0"
              :max-elevation-m="plannerProfile.maxElevationM ?? 0"
              :total-distance-m="plannerProfile.totalDistanceM"
            />
            <p v-if="plannerProfile.known < plannerProfile.requested" class="text-[10px] text-amber-500">
              {{ t("map.profile.partial", { known: plannerProfile.known, total: plannerProfile.requested }) }}
            </p>
          </div>

          <p v-if="plannerRouting" class="text-xs text-gray-500 text-center animate-pulse">
            {{ t("map.routing") }}
          </p>

          <!-- Ce fel de drum căutăm. Nu e un moft: pe același capete de traseu, „pe jos" urcă pe
               potecă, „MTB" urcă pe potecă tehnică, iar „bicicletă" ocolește pe drum forestier. -->
          <label class="block space-y-1">
            <span class="text-[10px] uppercase tracking-wide text-gray-500">
              {{ t("map.travelProfile.label") }}
            </span>
            <select
              v-model="plannerTravelProfile"
              class="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-orange-500 focus:outline-none"
              :disabled="plannerRouting"
              @change="rebuildSegments"
            >
              <option v-for="option in TRAVEL_PROFILES" :key="option.key" :value="option.key">
                {{ t(option.labelKey) }}
              </option>
            </select>
          </label>

          <!-- Rutarea căzută se spune, nu se desenează ca rută: pînă în F3, un eșec se prefăcea linie
               dreaptă, iar traseul părea calculat deși nu era (`docs/STUDY-MAP.md` §3.1.2). -->
          <p
            v-if="plannerRouteError"
            class="rounded-lg bg-amber-950/60 px-2 py-1.5 text-[11px] leading-snug text-amber-300"
          >
            {{ t("map.routingUnavailable") }}
          </p>

          <!-- Salvare / export: un planificator din care nu poți pleca cu traseul e un demo. -->
          <div v-if="plannerWaypoints.length >= 2" class="space-y-1">
            <input
              v-model="plannerName"
              type="text"
              :aria-label="t('map.routeName')"
              :placeholder="t('map.plannedRouteDefault')"
              class="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
            />
            <div class="flex gap-1">
              <button
                class="flex-1 rounded bg-emerald-700 py-1.5 text-xs text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
                :disabled="plannerSaveState === 'saving'"
                @click="plannerSave"
              >
                {{ plannerSaveState === "saving" ? t("map.saving") : t("map.saveRoute") }}
              </button>
              <button
                class="flex-1 rounded bg-gray-700 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-600"
                @click="plannerExport"
              >
                {{ t("map.exportGpx") }}
              </button>
            </div>
            <p v-if="plannerSaveState === 'saved'" class="text-xs text-center text-emerald-400">
              {{ t("map.routeSaved") }}
            </p>
            <p
              v-else-if="plannerSaveState === 'offline'"
              class="text-xs text-center text-amber-400"
            >
              {{ t("map.routeSaveOffline") }}
            </p>
          </div>

          <div class="flex gap-1">
            <button
              v-if="plannerWaypoints.length > 0"
              class="flex-1 py-1.5 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600"
              @click="plannerUndo"
            >
              ↩ {{ t("map.undoLast") }}
            </button>
            <button
              v-if="plannerWaypoints.length > 0"
              class="py-1.5 px-2 rounded text-xs bg-red-900/50 text-red-400 hover:bg-red-900"
              @click="plannerClear"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </aside>

    <!-- Harta -->
    <div class="flex-1 relative min-w-0 overflow-hidden" :class="{ 'planner-on': plannerActive }">
      <div ref="mapEl" class="w-full h-full" />

      <!-- „Unde sînt": o poziție, nu o urmărire continuă — harta se duce acolo și se oprește. -->
      <button
        class="absolute top-4 right-4 z-[1000] rounded-lg border border-gray-700 bg-gray-900/90 px-3 py-2 text-xs text-gray-200 transition-colors hover:bg-gray-800"
        :title="t('map.locate.title')"
        @click="locateMe"
      >
        {{ locating ? t("map.locate.locating") : t("map.locate.button") }}
      </button>
      <p
        v-if="locateError"
        class="absolute top-16 right-4 z-[1000] max-w-[220px] rounded-lg border border-gray-700 bg-gray-900/95 px-3 py-2 text-xs text-amber-400"
      >
        {{ locateError }}
      </p>

      <!-- Harta nu s-a putut porni (WebGL lipsă, stil indisponibil): se spune, nu se lasă gol. -->
      <div
        v-if="mapError"
        class="absolute inset-0 flex items-center justify-center bg-gray-950/90 z-[1100] p-6"
      >
        <p class="max-w-sm text-center text-sm text-gray-300">{{ mapError }}</p>
      </div>

      <!-- Legendă marcaje -->
      <div
        class="absolute bottom-6 right-4 bg-gray-900/90 border border-gray-700 rounded-xl px-4 py-3 z-[1000] space-y-1.5"
      >
        <p class="text-xs text-gray-500 uppercase tracking-wide mb-2">{{ t("map.markings") }}</p>
        <div v-for="[key, color] in MARKING_LEGEND" :key="key" class="flex items-center gap-2">
          <span class="w-5 h-0.5 rounded-full" :style="{ background: color }" />
          <span class="text-xs text-gray-400">{{ key }}</span>
        </div>
        <div class="flex items-center gap-2 pt-1 border-t border-gray-700">
          <span class="w-5 h-0.5 rounded-full bg-orange-500" />
          <span class="text-xs text-gray-400">{{ t("map.myRoutes") }}</span>
        </div>
      </div>

      <!-- Hint zoom insuficient -->
      <Transition name="fade">
        <div
          v-if="zoomTooLow"
          class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-gray-900/90 text-gray-400 text-xs px-4 py-2 rounded-full pointer-events-none z-[1000] border border-gray-700"
        >
          {{ t("map.zoomHintLow") }}
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
// Import de spațiu de nume: `maplibre-gl` v6 nu are export implicit, iar stilul de utilizare rămîne
// `maplibregl.Map`, `maplibregl.Popup` etc. — tipurile vin din același modul.
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRoutesStore } from "@/stores/routes";
import { API_BASE } from "@/utils/apiBase";
import {
  buildPlannedRoute,
  elevationGainLoss,
  joinSegments,
  sampleEvenlyWithDistances,
  segmentsDistanceMeters,
  type LatLon,
} from "@/utils/trailStats";
import {
  buildElevationProfile,
  estimateHikingMinutes,
  type ElevationProfile,
} from "@/utils/elevationProfile";
import { formatDurationShort } from "@/utils/duration";
import ElevationProfileChart from "@/components/ElevationProfileChart.vue";
import { downloadGpx } from "@/services/gpx/GpxWriter";
import { fetchElevations, MAX_ELEVATION_POINTS } from "@/services/api/elevationApi";
import { fetchRoute, TRAVEL_PROFILES, type TravelProfile } from "@/services/api/routingApi";
import { escapeHtml } from "@/utils/html";
import {
  MAP_STYLES,
  DEFAULT_MAP_STYLE,
  OUR_LAYERS,
  OUR_SOURCES,
  mapStyleUrl,
  type MapStyleKey,
} from "@/services/map/basemap";
import {
  TRAIL_FILTERS,
  buildOverpassQuery,
  overpassToGeoJson,
  parseOsmc,
  type OverpassElement,
  type OverpassResponse,
  type TrailFilterKey,
} from "@/services/map/osmTrails";
import {
  POI_TOGGLE_CATEGORIES,
  DEFAULT_ACTIVE_POI_CATEGORIES,
  poiColor,
  poisToGeoJson,
  type PoiCategoryKey,
} from "@/services/map/poiLayer";
import { plannedRouteToGeoJson, routesToGeoJson } from "@/services/map/routeLayers";
import {
  fetchMountainPois,
  searchMountainPois,
  MAX_POI_BBOX_SPAN_DEGREES,
  MIN_POI_SEARCH_LENGTH,
  type Bounds,
  type MountainPoi,
} from "@/services/api/mountainPoisApi";
import { createLocationTransport } from "@/services/geo/locationTransport";

const { t } = useI18n();

/**
 * Unde e worker-ul MapLibre.
 *
 * Fără asta, MapLibre îl caută singur lîngă chunk-ul lui (`./maplibre-gl-worker.mjs`) — o cale pe care
 * bundler-ul nu o vede, deci fișierul nu ajunge în build: harta se încarcă, tile-urile se descarcă,
 * dar worker-ul nu pornește și ecranul rămîne gol („Worker failed to load"). Îl servim noi, de la o
 * cale stabilă, în dev și în producție (vezi `maplibreWorker()` din `vite.config.ts`).
 */
maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre-worker/maplibre-gl-worker.mjs`);

// ── Stilul hărții ──────────────────────────────────────────────────────────
const activeStyle = ref<MapStyleKey>(DEFAULT_MAP_STYLE);

// ── Filtre de trasee ───────────────────────────────────────────────────────
const activeFilters = ref<TrailFilterKey[]>(["marked", "hiking"]);

// ── State ──────────────────────────────────────────────────────────────────
const routesStore = useRoutesStore();
const routes = computed(() => routesStore.routes);
const activeIdx = ref<number | null>(null);

const osmLoading = ref(false);
const osmError = ref<string | null>(null);
const osmCount = ref(0);
const zoomTooLow = ref(true);
const mapError = ref<string | null>(null);

// ── Harta ──────────────────────────────────────────────────────────────────
const mapEl = ref<HTMLDivElement | null>(null);
let map: maplibregl.Map | null = null;
/** Straturile noastre există doar după `style.load`; la schimbarea stilului se pierd și se readaugă. */
let ourLayersReady = false;

// Cache bbox-uri în memorie — evită refetch în aceeași sesiune
const loadedBboxCache = new Set<string>();
// Date brute per bbox — re-randare la schimbarea filtrelor fără request nou
const dataCache = new Map<string, OverpassElement[]>();

const STORAGE_KEY = "ttr_osm_cache";
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24h fallback local

const MIN_ZOOM = 13;

async function persistCache(bboxKey: string, elements: OverpassElement[]) {
  // Salvează în DB (shared între useri)
  try {
    await fetch(`${API_BASE}/osm-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bboxKey, elementsJson: JSON.stringify(elements) }),
    });
  } catch {
    // DB indisponibil — fallback localStorage
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const obj: Record<string, { ts: number; elements: OverpassElement[] }> = raw
        ? JSON.parse(raw)
        : {};
      obj[bboxKey] = { ts: Date.now(), elements };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* ignoră */
    }
  }
}

async function loadCachedBbox(bboxKey: string): Promise<OverpassElement[] | null> {
  // Încearcă DB mai întâi
  try {
    const res = await fetch(`${API_BASE}/osm-cache/${encodeURIComponent(bboxKey)}`);
    if (res.ok) {
      const data = (await res.json()) as { elementsJson: string };
      return JSON.parse(data.elementsJson) as OverpassElement[];
    }
  } catch {
    /* DB indisponibil */
  }

  // Fallback localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, { ts: number; elements: OverpassElement[] }>;
    const entry = obj[bboxKey];
    if (entry && Date.now() - entry.ts < STORAGE_TTL_MS) return entry.elements;
  } catch {
    /* ignoră */
  }

  return null;
}

function restoreCache() {
  // Cache-ul local se citește la pornire, ca o zonă vizitată recent să apară fără rețea.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, { ts: number; elements: OverpassElement[] }>;
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      if (now - v.ts < STORAGE_TTL_MS) {
        dataCache.set(k, v.elements);
        loadedBboxCache.add(k);
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let abortController: AbortController | null = null;
let resizeObserver: ResizeObserver | null = null;
let styleWatchdog: ReturnType<typeof setTimeout> | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

/** Cît așteptăm stilul de bază înainte să spunem în ecran că nu a venit. */
const STYLE_TIMEOUT_MS = 8000;

// ── Init hartă ─────────────────────────────────────────────────────────────
onMounted(async () => {
  if (!mapEl.value) return;

  try {
    map = new maplibregl.Map({
      container: mapEl.value,
      style: mapStyleUrl(activeStyle.value),
      center: [24.9, 45.75],
      zoom: 7,
      attributionControl: {
        compact: true,
        // Atribuirea DEM-ului e obligatorie cînd afișăm altitudini din el (Copernicus, DLR/Airbus).
        // Stă lîngă numele sursei de hărți, unde se uită lumea după așa ceva.
        customAttribution:
          "Altitudini: © DLR e.V. / Airbus DS — Copernicus DEM GLO-30 (AWS Open Data)",
      },
    });
  } catch (err) {
    // WebGL lipsă sau context refuzat: se spune în ecran, nu se lasă un dreptunghi gol.
    mapError.value = t("map.webglUnavailable");
    console.error("Harta nu a pornit:", err);
    return;
  }

  // **Workaround de dimensiune, obligatoriu.** MapLibre nu-și dă seama singur că containerul și-a
  // schimbat dimensiunea: dacă harta se creează înainte ca layout-ul flex/`calc(100vh-65px)` să fie
  // așezat, canvas-ul rămîne 0×0 și **nu se repară niciodată** — ecranul apare gol, fără nicio eroare.
  // Harta veche (Leaflet) avea exact acest fix (`invalidateSize`); la rescriere l-am pierdut.
  // `ResizeObserver` acoperă și restul cazurilor: bara laterală, fereastra, orientarea telefonului.
  requestAnimationFrame(() => map?.resize());
  resizeTimer = setTimeout(() => map?.resize(), 300);

  // `ResizeObserver` lipsește pe WebView-uri vechi (Chrome < 64, Safari < 13.1). Fără gardă, un
  // `new ResizeObserver` aruncă **în mijlocul** pornirii hărții și tot ce urmează (straturi, click,
  // încărcarea rutelor) nu se mai execută — iar eroarea e o promisiune respinsă, deci nici măcar nu se
  // vede în consolă ca atare. Redimensionarea rămîne acoperită de cele două apeluri de mai sus.
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => map?.resize());
    resizeObserver.observe(mapEl.value);
  }

  map.on("error", (event) => {
    // MapLibre raportează aici și erori trecătoare de tile-uri, deci nu umplem ecranul la fiecare.
    console.warn("Eroare MapLibre:", event.error?.message ?? event);
  });

  // La fiecare încărcare de stil (prima și după schimbare), straturile noastre se readaugă:
  // `setStyle` șterge tot ce am adăugat peste stilul de bază.
  map.on("style.load", () => {
    if (styleWatchdog) {
      clearTimeout(styleWatchdog);
      styleWatchdog = null;
    }
    mapError.value = null;
    addOurLayers();
    refreshAllLayers();
  });

  // Dacă stilul nu sosește (rețea blocată, sursă picată), ecranul trebuie s-o spună. Fără paznicul
  // ăsta, eșecul ar arăta exact ca o hartă goală — și nimeni n-ar ști dacă așteaptă sau e stricat.
  styleWatchdog = setTimeout(() => {
    if (!map) return;
    mapError.value = t("map.styleUnavailable");
  }, STYLE_TIMEOUT_MS);

  map.on("moveend", onMapMoveEnd);
  map.on("click", onMapClick);

  await routesStore.loadFromDb();
  restoreCache();
});

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (resizeTimer) clearTimeout(resizeTimer);
  if (styleWatchdog) clearTimeout(styleWatchdog);
  resizeObserver?.disconnect();
  resizeObserver = null;
  abortController?.abort();
  map?.remove();
  map = null;
  ourLayersReady = false;
});

// ── Straturile noastre peste stilul de bază ────────────────────────────────
function addOurLayers() {
  if (!map) return;
  ourLayersReady = false;

  for (const source of Object.values(OUR_SOURCES)) {
    if (map.getSource(source)) map.removeSource(source);
  }
  for (const layer of Object.values(OUR_LAYERS)) {
    if (map.getLayer(layer)) map.removeLayer(layer);
  }

  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  // Traseele OSM stau dedesubt: sînt context, nu subiectul ecranului.
  map.addSource(OUR_SOURCES.trails, { type: "geojson", data: empty });
  map.addLayer({
    id: OUR_LAYERS.trails,
    type: "line",
    source: OUR_SOURCES.trails,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      // Culoarea vine din marcajul traseului (`osmc:symbol`), calculată o dată la conversie.
      "line-color": ["get", "color"],
      "line-width": ["case", ["get", "relation"], 3, 2],
      "line-opacity": 0.85,
    },
  });

  map.addSource(OUR_SOURCES.myRoutes, { type: "geojson", data: empty });
  map.addLayer({
    id: OUR_LAYERS.myRoutes,
    type: "line",
    source: OUR_SOURCES.myRoutes,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["get", "selected"], "#d3974a", "#c98a3e"],
      "line-width": ["case", ["get", "selected"], 6, 4],
      "line-opacity": 0.9,
    },
  });

  map.addSource(OUR_SOURCES.plannedRoute, { type: "geojson", data: empty });
  map.addLayer({
    id: OUR_LAYERS.plannedRoute,
    type: "line",
    source: OUR_SOURCES.plannedRoute,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#6e9c8d", "line-width": 4, "line-opacity": 0.9 },
  });

  map.addSource(OUR_SOURCES.pois, { type: "geojson", data: empty });
  map.addLayer({
    id: OUR_LAYERS.pois,
    type: "circle",
    source: OUR_SOURCES.pois,
    paint: {
      "circle-radius": 6,
      "circle-color": ["get", "color"],
      // Contur plin = un om a confirmat punctul; estompat = doar citit de la sursă (§7.2).
      "circle-stroke-color": ["case", ["get", "verified"], "#ffffff", "rgba(255,255,255,0.45)"],
      "circle-stroke-width": 2,
    },
  });

  map.on("mouseenter", OUR_LAYERS.pois, () => setCursor("pointer"));
  map.on("mouseleave", OUR_LAYERS.pois, () => setCursor(""));
  map.on("mouseenter", OUR_LAYERS.trails, () => setCursor("pointer"));
  map.on("mouseleave", OUR_LAYERS.trails, () => setCursor(""));
  map.on("mouseenter", OUR_LAYERS.myRoutes, () => setCursor("pointer"));
  map.on("mouseleave", OUR_LAYERS.myRoutes, () => setCursor(""));

  map.on("click", OUR_LAYERS.pois, onPoiClick);
  map.on("click", OUR_LAYERS.trails, onTrailClick);
  map.on("click", OUR_LAYERS.myRoutes, onMyRouteClick);

  ourLayersReady = true;
}

function setCursor(cursor: string) {
  if (map) map.getCanvas().style.cursor = cursor;
}

function setLayerData(sourceId: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature) {
  if (!map || !ourLayersReady) return;
  (map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

/** Reaplică tot ce avem deja în memorie — după o schimbare de stil, cînd straturile se recreează. */
function refreshAllLayers() {
  refreshTrailLayer();
  refreshRouteLayer();
  refreshPlannedLayer();
  refreshPoiLayer();
}

// ── Stiluri ────────────────────────────────────────────────────────────────
function switchStyle(key: MapStyleKey) {
  if (!map || activeStyle.value === key) return;
  activeStyle.value = key;
  ourLayersReady = false;
  map.setStyle(mapStyleUrl(key));
  // Straturile noastre se readaugă din `style.load`.
}

// ── Trasee OSM ─────────────────────────────────────────────────────────────
function onMapMoveEnd() {
  if (!map) return;

  // Punctele montane se cer **înainte** de poarta de zoom a traseelor: la zoom mic traseele OSM nu se
  // încarcă (răspunsul Overpass ar fi uriaș), dar o cabană e utilă tocmai cînd te uiți la un masiv.
  scheduleMountainPoiLoad();

  const zoom = map.getZoom();
  zoomTooLow.value = zoom < MIN_ZOOM;
  if (zoom < MIN_ZOOM) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void loadOsmRoutes();
  }, 600);
}

function bboxKey(bounds: maplibregl.LngLatBounds): string {
  // Rotunjit la 1 zecimală — tiles de ~11km, suficient pentru caching
  return [
    bounds.getSouth().toFixed(1),
    bounds.getWest().toFixed(1),
    bounds.getNorth().toFixed(1),
    bounds.getEast().toFixed(1),
  ].join(",");
}

function currentBounds(): Bounds {
  const bounds = map!.getBounds();
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

async function loadOsmRoutes() {
  if (!map) return;

  const key = bboxKey(map.getBounds());
  if (loadedBboxCache.has(key)) {
    refreshTrailLayer();
    return;
  }

  // Verifică cache-ul DB/localStorage înainte de Overpass
  const cached = await loadCachedBbox(key);
  if (cached) {
    loadedBboxCache.add(key);
    dataCache.set(key, cached);
    refreshTrailLayer();
    return;
  }

  abortController?.abort();
  abortController = new AbortController();

  const activeFilterDefs = TRAIL_FILTERS.filter((filter) => activeFilters.value.includes(filter.key));
  if (activeFilterDefs.length === 0) return;

  const query = buildOverpassQuery(activeFilters.value, currentBounds());

  osmLoading.value = true;
  osmError.value = null;

  const MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  try {
    let lastErr: unknown;
    for (const mirror of MIRRORS) {
      if (abortController.signal.aborted) return;
      try {
        const res = await fetch(mirror, {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(20_000)]),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as OverpassResponse;

        loadedBboxCache.add(key);
        dataCache.set(key, data.elements);
        void persistCache(key, data.elements);
        currentTrailElements = data.elements;
        refreshTrailLayer();
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        lastErr = err;
        console.warn(`Overpass mirror ${mirror} failed, trying next...`, err);
      }
    }
    osmError.value = t("map.osmUnavailable");
    console.error("All Overpass mirrors failed:", lastErr);
  } finally {
    osmLoading.value = false;
  }
}

/** Elementele zonei curente. Setul vechi se înlocuiește, nu se adună: harta arată ce vezi. */
let currentTrailElements: OverpassElement[] = [];

function refreshTrailLayer() {
  const collection = overpassToGeoJson(currentTrailElements);
  setLayerData(OUR_SOURCES.trails, collection);
  osmCount.value = collection.features.length;
}

function onTrailFiltersChanged() {
  // Filtrele schimbă ce se cere de la Overpass, deci zona curentă se reia; restul din cache rămîne.
  currentTrailElements = [];
  for (const [key, elements] of dataCache) {
    if ([...loadedBboxCache].includes(key)) currentTrailElements.push(...elements);
  }
  refreshTrailLayer();

  if (map && map.getZoom() >= MIN_ZOOM) {
    void loadOsmRoutes();
  }
}

// ── Puncte montane ─────────────────────────────────────────────────────────
const activePoiCategories = ref<PoiCategoryKey[]>([...DEFAULT_ACTIVE_POI_CATEGORIES]);
const mountainPois = ref<MountainPoi[]>([]);
const poiLoading = ref(false);
const poiError = ref<string | null>(null);
const poiLoaded = ref(false);

let poiAbortController: AbortController | null = null;
let poiDebounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Ultimul dreptunghi pentru care avem puncte: evită o cerere nouă la fiecare mișcare de un pixel. */
let loadedPoiKey: string | null = null;

function poiLabel(category: string): string {
  return t(`map.poi.${category}`);
}

function refreshPoiLayer() {
  setLayerData(OUR_SOURCES.pois, poisToGeoJson(mountainPois.value, activePoiCategories.value));
}

function scheduleMountainPoiLoad() {
  if (poiDebounceTimer) clearTimeout(poiDebounceTimer);
  poiDebounceTimer = setTimeout(() => void loadMountainPois(), 600);
}

async function loadMountainPois() {
  if (!map) return;

  const area = currentBounds();

  // Peste plafonul acceptat de backend (10°): la zoom de țară nu cerem nimic, în loc să luăm 400.
  if (
    area.north - area.south > MAX_POI_BBOX_SPAN_DEGREES ||
    area.east - area.west > MAX_POI_BBOX_SPAN_DEGREES
  ) {
    return;
  }

  const key = [area.south, area.west, area.north, area.east].map((v) => v.toFixed(3)).join(",");
  if (key === loadedPoiKey) return;

  poiAbortController?.abort();
  poiAbortController = new AbortController();
  poiLoading.value = true;
  poiError.value = null;

  try {
    // Toate categoriile o dată: filtrele se aplică la desenare, deci bifarea uneia nu cere rețea.
    const pois = await fetchMountainPois(area, [], poiAbortController.signal);
    mountainPois.value = pois;
    loadedPoiKey = key;
    poiLoaded.value = true;
    refreshPoiLayer();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    poiError.value = t("map.poi.unavailable");
    console.warn("Punctele montane nu s-au putut încărca:", err);
  } finally {
    poiLoading.value = false;
  }
}

/**
 * Citește o proprietate ca text. Proprietățile GeoJSON vin ca `unknown` (și lipsesc adesea), iar
 * `noUncheckedIndexedAccess` nu ne lasă să le tratăm ca sigur prezente — de aceea un singur loc care
 * normalizează, în loc de `?? ""` împrăștiat prin fiecare popup.
 */
function prop(properties: Record<string, unknown>, key: string): string {
  const value = properties[key];
  return typeof value === "string" ? value : "";
}

/**
 * Popup-ul unui punct. Textul vine din OSM, pe care oricine îl poate edita, deci **fiecare** valoare
 * trece prin `escapeHtml`.
 *
 * Stă separat de handler pentru că e folosit în două locuri: la click pe hartă și la click pe un
 * rezultat de căutare. Două popup-uri aproape la fel ar ajunge să arate diferit.
 */
function poiPopupHtml(properties: Record<string, unknown>): string {
  const name = prop(properties, "name") || poiLabel(prop(properties, "category"));

  const lines: string[] = [];
  const elevation = properties.elevationM;
  if (typeof elevation === "number" && Number.isFinite(elevation)) {
    lines.push(`${t("map.poi.elevation")}: ${Math.round(elevation)} m`);
  }
  const detailsText = prop(properties, "details");
  if (detailsText) lines.push(detailsText);

  const details = lines
    .map((line) => `<div style="color:#5c6066;font-size:11px">${escapeHtml(line)}</div>`)
    .join("");

  const state =
    properties.verified === true || properties.verified === "true"
      ? `<span style="color:#6e9c8d">${escapeHtml(t("map.poi.verified"))}</span>`
      : `<span style="color:#8b8f96">${escapeHtml(t("map.poi.unverified"))}</span>`;

  const notesText = prop(properties, "notes");
  const notes = notesText
    ? `<div style="color:#b9bec4;font-size:11px;margin-top:2px">${escapeHtml(notesText)}</div>`
    : "";

  return `<div style="font-family:sans-serif">
        <div style="color:#e07a5f;font-size:11px;text-transform:uppercase">${escapeHtml(poiLabel(prop(properties, "category")))}</div>
        <div style="color:#edebe6;font-size:13px">${escapeHtml(name)}</div>
        ${details}
        ${notes}
        <div style="margin-top:3px;font-size:11px">${state}</div>
        <div style="color:#5c6066;font-size:10px">${escapeHtml(t("map.poi.source"))}: ${escapeHtml(prop(properties, "source"))} ${escapeHtml(prop(properties, "sourceRef"))}</div>
      </div>`;
}

function onPoiClick(event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
  const feature = event.features?.[0];
  if (!feature || !map) return;

  new maplibregl.Popup({ maxWidth: "280px" })
    .setLngLat(event.lngLat)
    .setHTML(poiPopupHtml(feature.properties as Record<string, unknown>))
    .addTo(map);
}

// ── Căutare ────────────────────────────────────────────────────────────────
//
// Se caută în **baza noastră**, nu într-un geocoder extern: punctele montane au deja nume, categorie și
// altitudine, iar un serviciu extern ar însemna altă dependență, altă politică de utilizare și altă
// cache. Cînd vom vrea și localități și străzi, se adaugă atunci, ca sursă separată.

const searchQuery = ref("");
const searchResults = ref<MountainPoi[]>([]);
const searchLoading = ref(false);
const searchError = ref<string | null>(null);

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
let searchAbort: AbortController | null = null;

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => void runSearch(), 300);
}

async function runSearch() {
  const query = searchQuery.value.trim();
  searchAbort?.abort();
  searchError.value = null;

  if (query.length < MIN_POI_SEARCH_LENGTH) {
    searchResults.value = [];
    return;
  }

  searchAbort = new AbortController();
  searchLoading.value = true;
  try {
    searchResults.value = await searchMountainPois(query, searchAbort.signal);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    searchError.value = t("map.search.unavailable");
    searchResults.value = [];
  } finally {
    searchLoading.value = false;
  }
}

/** Duce harta la un rezultat și deschide popup-ul lui. */
function goToPoi(poi: MountainPoi) {
  if (!map) return;

  // Dacă punctul e într-o categorie neafișată, se aprinde: altfel căutarea te duce într-un loc gol.
  const category = poi.category as PoiCategoryKey;
  if (!activePoiCategories.value.includes(category)) {
    activePoiCategories.value = [...activePoiCategories.value, category];
    refreshPoiLayer();
  }

  const center: [number, number] = [poi.longitude, poi.latitude];
  map.flyTo({ center, zoom: 14 });

  const feature = poisToGeoJson([poi], [category]).features[0];
  new maplibregl.Popup({ maxWidth: "280px" })
    .setLngLat(center)
    .setHTML(poiPopupHtml((feature?.properties ?? {}) as Record<string, unknown>))
    .addTo(map);

  searchResults.value = [];
  searchQuery.value = poi.name || poiLabel(poi.category);
}

// ── „Unde sînt" ────────────────────────────────────────────────────────────
//
// O poziție, nu o urmărire continuă: harta se duce acolo și se oprește. Urmărirea live e pentru
// înregistrare (`/run`, `/ride`), unde contează fiecare secundă; aici ar consuma baterie degeaba.

const locating = ref(false);
const locateError = ref<string | null>(null);
let locateMarker: maplibregl.Marker | null = null;

async function locateMe() {
  if (!map || locating.value) return;
  locateError.value = null;

  const transport = createLocationTransport();
  if (!transport.isSupported()) {
    locateError.value = t("map.locate.unsupported");
    return;
  }

  locating.value = true;
  let watchId: number | string | null = null;

  const stopWatch = () => {
    if (watchId !== null) void transport.clearWatch(watchId);
    watchId = null;
  };

  try {
    const permission = await transport.requestPermission();
    if (permission === "denied") {
      locateError.value = t("map.locate.denied");
      locating.value = false;
      return;
    }

    watchId = await transport.watch({
      onFix: (fix) => {
        stopWatch();
        if (!map) return;

        locateMarker?.remove();
        locateMarker = new maplibregl.Marker({ color: "#3b82f6" })
          .setLngLat([fix.longitude, fix.latitude])
          .addTo(map);
        map.flyTo({ center: [fix.longitude, fix.latitude], zoom: 14 });
        locating.value = false;
      },
      onError: () => {
        stopWatch();
        locateError.value = t("map.locate.unavailable");
        locating.value = false;
      },
    });
  } catch {
    stopWatch();
    locateError.value = t("map.locate.unavailable");
    locating.value = false;
  }
}

// ── Legendă marcaje ────────────────────────────────────────────────────────
const MARKING_LEGEND = computed<[string, string][]>(() => [
  [t("map.legend.redCross"), "#d16f72"],
  [t("map.legend.blueBand"), "#8fa3b0"],
  [t("map.legend.yellowTriangle"), "#d9a441"],
  [t("map.legend.greenDot"), "#6e9c8d"],
  [t("map.legend.redBand"), "#d16f72"],
  [t("map.legend.mtbTrack"), "#8fa3b0"],
]);

const OSMC_SHAPE_LABEL = computed<Record<string, string>>(() => ({
  cross: t("map.osmc.cross"),
  stripe: t("map.osmc.stripe"),
  dot: t("map.osmc.dot"),
  triangle: t("map.osmc.triangle"),
  triangle_turned: t("map.osmc.triangleTurned"),
  diamond: t("map.osmc.diamond"),
  rectangle: t("map.osmc.rectangle"),
  circle: t("map.osmc.circle"),
  bar: t("map.osmc.bar"),
  fork: t("map.osmc.fork"),
  arch: t("map.osmc.arch"),
  turned_T: t("map.osmc.turnedT"),
  x: t("map.osmc.x"),
  corner: t("map.osmc.corner"),
  backslash: t("map.osmc.backslash"),
  shell: t("map.osmc.shell"),
}));

function osmcLabel(symbol: string): string {
  const { colorName, shapeName } = parseOsmc(symbol);
  return [colorName, OSMC_SHAPE_LABEL.value[shapeName] ?? shapeName].filter(Boolean).join(" ");
}

/**
 * Popup-ul unui traseu. Textul vine din OpenStreetMap, pe care oricine îl poate edita, deci **fiecare**
 * valoare trece prin `escapeHtml` — altfel un nume de traseu ar putea injecta HTML în aplicație.
 */
function onTrailClick(event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
  const feature = event.features?.[0];
  if (!feature || !map) return;

  const properties = feature.properties as Record<string, unknown>;
  const distance = prop(properties, "distance");
  const details = [
    prop(properties, "network"),
    prop(properties, "sacScale"),
    prop(properties, "surface"),
    distance ? `${distance} km` : "",
  ]
    .filter((part) => part !== "")
    .map((part) => escapeHtml(part))
    .join(" · ");

  const osmc = prop(properties, "osmc");
  const marking = osmc
    ? `<div style="color:${parseOsmc(osmc).color};font-size:11px;font-weight:bold">${escapeHtml(osmcLabel(osmc))}</div>`
    : "";

  const name = prop(properties, "name");

  new maplibregl.Popup({ maxWidth: "280px" })
    .setLngLat(event.lngLat)
    .setHTML(
      `<div style="font-family:sans-serif">
        ${marking}
        ${name ? `<div style="color:#edebe6;font-size:13px">${escapeHtml(name)}</div>` : ""}
        ${details ? `<div style="color:#5c6066;font-size:11px">${details}</div>` : ""}
      </div>`,
    )
    .addTo(map);
}

// ── Rutele mele ────────────────────────────────────────────────────────────
watch(() => routesStore.routes, refreshRouteLayer, { deep: true });

function refreshRouteLayer() {
  setLayerData(OUR_SOURCES.myRoutes, routesToGeoJson(routes.value, activeIdx.value));
}

function onMyRouteClick(event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
  const feature = event.features?.[0];
  if (!feature || !map) return;

  const properties = feature.properties as Record<string, unknown>;
  const distanceKm = typeof properties.distanceKm === "number" ? properties.distanceKm.toFixed(1) : "0";
  const gainM = typeof properties.elevationGainM === "number" ? Math.round(properties.elevationGainM) : 0;

  new maplibregl.Popup({ maxWidth: "280px" })
    .setLngLat(event.lngLat)
    .setHTML(
      `<div style="font-family:sans-serif">
        <b style="color:#edebe6">${escapeHtml(prop(properties, "name"))}</b><br>
        <span style="color:#5c6066;font-size:11px">${escapeHtml(distanceKm)} km · ${escapeHtml(String(gainM))} m D+</span>
      </div>`,
    )
    .addTo(map);
}

function focusRoute(idx: number) {
  activeIdx.value = idx;
  const route = routes.value[idx];
  if (!route || !map || route.points.length === 0) return;

  const lons = route.points.map((point) => point.lon);
  const lats = route.points.map((point) => point.lat);
  map.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: 40, maxZoom: 15 },
  );

  refreshRouteLayer();
}

// ── Planner traseu ─────────────────────────────────────────────────────────
//
// Starea planificatorului: punctele alese de utilizator plus segmentele de rută dintre ele.
// Segmentele se țin împreună, ca „anulează ultimul" să refacă deodată desenul și distanța.
//
// Ce **nu** facem aici: altitudinea. Backend-ul nu servește încă o sursă (`/api/elevation` nu
// există), deci D+/D− nu se afișează deloc, în loc să se afișeze `0 m` dintr-un `catch` gol
// (`docs/STUDY-MAP.md` §3.1.1).

const plannerActive = ref(false);
const plannerWaypoints = ref<LatLon[]>([]);
const plannerDistance = ref(0);
const plannerRouting = ref(false);
const plannerName = ref("");
const plannerSaveState = ref<"idle" | "saving" | "saved" | "offline">("idle");

/** Ce fel de drum căutăm. Se trimite motorului de rutare, care are profiluri de cost separate. */
const plannerTravelProfile = ref<TravelProfile>("foot");

/**
 * Mesajul de eroare al rutării, sau `null` cînd ultima rutare a reușit.
 *
 * Ecranul **spune** cînd motorul nu răspunde, iar traseul desenat atunci e o linie dreaptă între
 * puncte — vizibil altfel decît o rută. Înainte, un eșec se ascundea într-un `catch` care întorcea
 * exact aceeași linie dreaptă, fără nicio deosebire pe ecran (`docs/STUDY-MAP.md` §3.1.2).
 */
const plannerRouteError = ref<string | null>(null);

/**
 * D+/D− din DEM-ul Copernicus, prin backend. `null` = nu le știm încă sau sursa nu a răspuns —
 * ecranul spune atunci „indisponibil", nu afișează un zero care ar minți (asta se întîmpla înainte
 * de F1, cînd apelul mergea într-un endpoint inexistent și eșecul era înghițit).
 */
const plannerElevGain = ref<number | null>(null);
const plannerElevLoss = ref<number | null>(null);
const plannerElevLoading = ref(false);
/** Profilul altimetric al traseului, pentru grafic. `null` cînd nu avem destule altitudini. */
const plannerProfile = ref<ElevationProfile | null>(null);
/** Durata estimată, în minute (model tip Naismith). `null` cînd nu se poate estima. */
const plannerMinutes = ref<number | null>(null);

let plannerElevDebounce: ReturnType<typeof setTimeout> | null = null;
let plannerElevToken = 0;

const plannerMarkers: maplibregl.Marker[] = [];
/** Un segment = ruta reală dintre două puncte alese. */
let plannerSegments: LatLon[][] = [];

/**
 * Biletul de ordine al calculelor de rută. Fiecare calcul nou îl incrementează, iar un răspuns care
 * întîrzie se aruncă: altfel o tragere rapidă de punct desenează segmente din două geometrii diferite.
 */
let plannerRunToken = 0;

function togglePlanner() {
  plannerActive.value = !plannerActive.value;
  if (!plannerActive.value) plannerClear();
  nextTick(() => map?.resize());
}

function plannerClear() {
  plannerRunToken++;
  plannerMarkers.forEach((marker) => marker.remove());
  plannerMarkers.length = 0;
  plannerSegments = [];
  plannerWaypoints.value = [];
  plannerDistance.value = 0;
  plannerRouting.value = false;
  plannerSaveState.value = "idle";
  plannerRouteError.value = null;
  resetElevations();
  refreshPlannedLayer();
}

/** Geometria completă a traseului planificat, fără punctul de legătură scris de două ori. */
function plannerGeometry(): LatLon[] {
  return joinSegments(plannerSegments);
}

function recalcStats() {
  plannerDistance.value = segmentsDistanceMeters(plannerSegments);
}

/**
 * Cere altitudinile pentru traseul curent, după o scurtă liniște: fiecare cerere ajunge la AWS, iar
 * planificatorul se schimbă la fiecare click și la fiecare tragere de punct.
 */
function scheduleElevations() {
  if (plannerElevDebounce) clearTimeout(plannerElevDebounce);
  plannerElevDebounce = setTimeout(() => void loadElevations(), 500);
}

async function loadElevations() {
  const geometry = plannerGeometry();
  if (geometry.length < 2) {
    resetElevations();
    return;
  }

  const token = ++plannerElevToken;
  plannerElevLoading.value = true;

  try {
    // Eșantionul vine cu distanțele de pe geometria **întreagă**, ca axa graficului să nu contrazică
    // distanța totală afișată lîngă el.
    const samples = sampleEvenlyWithDistances(geometry, MAX_ELEVATION_POINTS);
    const results = await fetchElevations(samples.points);
    if (token !== plannerElevToken) return; // un traseu mai nou a preluat

    const elevations = results.map((result) => result.elevation);
    const { gainM, lossM } = elevationGainLoss(elevations);
    plannerElevGain.value = gainM;
    plannerElevLoss.value = lossM;

    const profile = buildElevationProfile(samples.distancesM, elevations);
    plannerProfile.value = profile.points.length >= 2 ? profile : null;

    const totalDistance = samples.distancesM[samples.distancesM.length - 1] ?? 0;
    plannerMinutes.value = gainM === null ? null : estimateHikingMinutes(totalDistance, gainM);
  } catch (err) {
    if (token !== plannerElevToken) return;
    // Sursa a picat: se spune „indisponibil", nu se inventează o cifră.
    resetElevations();
    console.warn("Altitudinile nu au putut fi citite:", err);
  } finally {
    if (token === plannerElevToken) plannerElevLoading.value = false;
  }
}

function resetElevations() {
  plannerElevGain.value = null;
  plannerElevLoss.value = null;
  plannerProfile.value = null;
  plannerMinutes.value = null;
}

const plannerDurationLabel = computed(() =>
  plannerMinutes.value === null ? "" : formatDurationShort(plannerMinutes.value * 60),
);

function refreshPlannedLayer() {
  const geometry = plannerGeometry();
  const feature = plannedRouteToGeoJson(geometry, plannerWaypoints.value.length);
  setLayerData(
    OUR_SOURCES.plannedRoute,
    feature ?? { type: "FeatureCollection", features: [] },
  );
}

function createWaypointMarker(point: LatLon, index: number): maplibregl.Marker {
  const element = document.createElement("div");
  element.style.cssText = `width:12px;height:12px;border-radius:50%;background:${
    index === 0 ? "#6e9c8d" : "#c98a3e"
  };border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:grab`;

  const marker = new maplibregl.Marker({ element, draggable: true })
    .setLngLat([point.lon, point.lat])
    .addTo(map!);

  // `dragend`, nu `drag`: reconstrucția cere o rutare per segment, iar pe `drag` ar trimite zeci de
  // cereri pe secundă către serverul de rutare (care e public și fără SLA).
  marker.on("dragend", () => {
    const position = marker.getLngLat();
    plannerWaypoints.value[index] = { lat: position.lat, lon: position.lng };
    plannerSaveState.value = "idle";
    void rebuildSegments();
  });

  return marker;
}

async function addWaypoint(point: LatLon) {
  const previous = plannerWaypoints.value[plannerWaypoints.value.length - 1] ?? null;
  plannerWaypoints.value.push(point);
  plannerMarkers.push(createWaypointMarker(point, plannerMarkers.length));
  plannerSaveState.value = "idle";

  if (!previous) {
    recalcStats();
    return;
  }

  const token = ++plannerRunToken;
  plannerRouting.value = true;
  try {
    const segments = await routeSegments(plannerWaypoints.value);
    if (token !== plannerRunToken) return; // un calcul mai nou a preluat
    plannerSegments = segments;
    recalcStats();
    refreshPlannedLayer();
    scheduleElevations();
  } finally {
    if (token === plannerRunToken) plannerRouting.value = false;
  }
}

/** Reface toate segmentele din punctele curente — după tragerea unui punct sau schimbarea profilului. */
async function rebuildSegments() {
  const waypoints = plannerWaypoints.value;
  const token = ++plannerRunToken;

  plannerSegments = [];
  recalcStats();
  refreshPlannedLayer();

  if (waypoints.length < 2) return;

  plannerRouting.value = true;
  try {
    const segments = await routeSegments(waypoints);
    if (token !== plannerRunToken) return;
    plannerSegments = segments;
    recalcStats();
    refreshPlannedLayer();
    scheduleElevations();
  } finally {
    if (token === plannerRunToken) plannerRouting.value = false;
  }
}

function plannerUndo() {
  if (plannerWaypoints.value.length === 0) return;
  // Anulează cererile în zbor: altfel segmentul tocmai șters reapare cînd sosește răspunsul.
  plannerRunToken++;
  plannerMarkers.pop()?.remove();
  plannerWaypoints.value.pop();
  plannerSegments.pop();
  plannerRouting.value = false;
  plannerSaveState.value = "idle";
  recalcStats();
  refreshPlannedLayer();
  scheduleElevations();
}

function onMapClick(event: maplibregl.MapMouseEvent) {
  if (!plannerActive.value) return;
  void addWaypoint({ lat: event.lngLat.lat, lon: event.lngLat.lng });
}

/**
 * Segmentele traseului, calculate **într-o singură cerere** către backend — care le cere motorului
 * nostru de rutare. Un traseu cu cinci puncte însemna înainte cinci cereri către un serviciu public;
 * acum e una singură, iar motorul vede tot drumul deodată.
 *
 * Cînd rutarea nu răspunde, întoarce linii drepte **și spune de ce**: desenul rămîne utilizabil, dar
 * nu se preface că ar fi rută (`docs/STUDY-MAP.md` §3.1.2).
 */
async function routeSegments(waypoints: readonly LatLon[]): Promise<LatLon[][]> {
  const straight: LatLon[][] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    if (from && to) straight.push([from, to]);
  }
  if (straight.length === 0) return [];

  try {
    const plan = await fetchRoute(waypoints, plannerTravelProfile.value);
    const legs = plan.legs.map((leg) => leg.geometry.map(([lon, lat]) => ({ lat, lon })));
    // Un traseu are exact atîtea etape cîte perechi de puncte; orice altceva înseamnă că răspunsul
    // nu corespunde cererii, iar segmentele s-ar potrivi pe puncte greșite.
    if (legs.length !== straight.length || legs.some((leg) => leg.length < 2)) {
      plannerRouteError.value = "Răspuns de rutare neașteptat.";
      return straight;
    }
    plannerRouteError.value = null;
    return legs;
  } catch (error) {
    plannerRouteError.value = error instanceof Error ? error.message : String(error);
    return straight;
  }
}

/** Traseul planificat, în forma pe care o știu store-ul de trasee, API-ul și ride-ul. */
function plannedRoute() {
  const name = plannerName.value.trim() || t("map.plannedRouteDefault");
  return buildPlannedRoute(name, plannerGeometry());
}

async function plannerSave() {
  if (plannerWaypoints.value.length < 2 || plannerSaveState.value === "saving") return;
  plannerSaveState.value = "saving";
  const persisted = await routesStore.addRouteObject(plannedRoute());
  plannerSaveState.value = persisted ? "saved" : "offline";
}

function plannerExport() {
  if (plannerWaypoints.value.length < 2) return;
  downloadGpx(plannedRoute());
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
