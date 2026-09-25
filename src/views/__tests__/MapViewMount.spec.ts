import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";

/**
 * Ecranul de hartă **se montează și randează**.
 *
 * De ce un test atît de „prost": dacă ecranul aruncă la evaluare sau la montare, Vue Router nu
 * randează nimic, iar pagina apare **complet goală** — fără bară laterală, fără hartă, fără mesaj de
 * eroare. Shell-ul aplicației rămîne vizibil, deci pare că „nu se încarcă harta", cînd de fapt nu se
 * încarcă nimic. Exact asta s-a întîmplat pe 2026-09-24 și niciun test nu a prins-o: suita verifica
 * logica din module, dar nimeni nu monta componenta.
 *
 * MapLibre e simulat: aici nu ne interesează randarea hărții (n-are WebGL în jsdom), ci faptul că
 * ecranul ajunge să deseneze ceva și că își forță dimensiunea.
 */

const calls = vi.hoisted(() => ({
  constructed: 0,
  resize: 0,
  workerUrl: null as string | null,
  /** Handler-ele înregistrate pe hartă, ca testul să poată simula un click pe hartă. */
  handlers: {} as Record<string, ((event: unknown) => void)[]>,
}));

const mapStub = {
  on: (event: string, handler: (event: unknown) => void) => {
    (calls.handlers[event] ??= []).push(handler);
  },
  resize: () => {
    calls.resize += 1;
  },
  remove: () => undefined,
  getBounds: () => ({
    getSouth: () => 45.3,
    getWest: () => 24.2,
    getNorth: () => 45.8,
    getEast: () => 25.0,
  }),
  getZoom: () => 13,
  getSource: () => undefined,
  addSource: () => undefined,
  addLayer: () => undefined,
  getLayer: () => undefined,
  removeLayer: () => undefined,
  removeSource: () => undefined,
  getCanvas: () => ({ style: {} }),
  setStyle: () => undefined,
  fitBounds: () => undefined,
  flyTo: () => undefined,
};

vi.mock("maplibre-gl", () => ({
  Map: class {
    constructor() {
      calls.constructed += 1;
      return mapStub;
    }
  },
  Marker: class {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    on() {
      return this;
    }
    remove() {
      return this;
    }
  },
  Popup: class {
    setLngLat() {
      return this;
    }
    setHTML() {
      return this;
    }
    addTo() {
      return this;
    }
  },
  setWorkerUrl: (url: string) => {
    calls.workerUrl = url;
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "ro",
  fallbackLocale: "ro",
  messages: {
    ro: {
      map: {
        title: "Harta traseelor",
        zoomHint: "Zoom",
        mapStyle: "Stil hartă",
        routeTypes: "Tipuri trasee",
        myRoutes: "Rutele mele",
        loading: "Se încarcă...",
        noRoutes: "Nicio rută.",
        osmLoading: "Se încarcă trasee...",
        osmSegments: "{count} segmente",
        zoomTooLow: "Mărește",
        noTrails: "Niciun traseu",
        plannerActive: "Planificare activă",
        planRoute: "Planifică traseu",
        plannerFirstPoint: "Click pe hartă",
        points: "{count} puncte",
        distance: "Distanță",
        elevationUnavailable: "Indisponibil",
        gain: "D+",
        loss: "D−",
        calculatingElevation: "Se calculează...",
        undoLast: "Anulează",
        markings: "Marcaje",
        zoomHintLow: "Mărește zoom-ul",
        osmUnavailable: "Overpass indisponibil",
        start: "Start",
        finish: "Finish",
        noRouteSelected: "Niciun traseu selectat",
        routeName: "Nume",
        plannedRouteDefault: "Traseu planificat",
        saveRoute: "Salvează",
        saving: "Se salvează...",
        routeSaved: "Salvat",
        routeSaveOffline: "Local",
        exportGpx: "Exportă GPX",
        webglUnavailable: "Fără WebGL",
        styleUnavailable: "Hărțile nu s-au încărcat",
        layers: { liberty: "L", bright: "B", positron: "P", dark: "D" },
        filters: { marked: "Marcate", hiking: "Poteci", mtb: "MTB", cycling: "Ciclism" },
        poi: {
          title: "Puncte montane",
          hut: "Cabane",
          shelter: "Refugii",
          rescue: "Salvamont",
          water: "Apă",
          viewpoint: "Belvedere",
          guidepost: "Indicatoare",
          warning: "Zone",
          loading: "Se încarcă",
          empty: "Gol",
          unavailable: "Indisponibil",
          verified: "Verificat",
          unverified: "Neverificat",
          elevation: "Altitudine",
          source: "Sursă",
        },
        search: { label: "Caută", placeholder: "Caută", empty: "Nimic", unavailable: "Eroare" },
        locate: {
          button: "Unde",
          title: "Poziția",
          locating: "Se caută",
          denied: "Refuzat",
          unavailable: "Indisponibil",
          unsupported: "Nesuportat",
        },
        profile: { title: "Profil", chartLabel: "Grafic", estimated: "Durată", partial: "Parțial" },
        routing: "Se recalculează...",
        routingUnavailable: "Rutarea nu e disponibilă acum",
        travelProfile: { label: "Se merge", foot: "Pe jos", bike: "Bicicletă", mtb: "MTB" },
        legend: {
          redCross: "Cruce",
          blueBand: "Bandă",
          yellowTriangle: "Triunghi",
          greenDot: "Punct",
          redBand: "Bandă roșie",
          mtbTrack: "MTB",
        },
        osmc: {
          cross: "cruce",
          stripe: "bandă",
          dot: "punct",
          triangle: "triunghi",
          triangleTurned: "triunghi",
          diamond: "romb",
          rectangle: "dreptunghi",
          circle: "cerc",
          bar: "bară",
          fork: "furcă",
          arch: "arc",
          turnedT: "T",
          x: "X",
          corner: "colț",
          backslash: "diagonală",
          shell: "scoică",
        },
      },
    },
  },
});

describe("ecranul de hartă", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    calls.constructed = 0;
    calls.resize = 0;
    calls.workerUrl = null;
    for (const key of Object.keys(calls.handlers)) delete calls.handlers[key];
    // Ecranul întreabă API-ul de trasee la montare; în test nu vrem rețea.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })),
    );
  });

  it("se montează și desenează bara laterală", async () => {
    const { default: MapExplorerView } = await import("@/views/MapView.vue");

    const wrapper = mount(MapExplorerView, {
      global: { plugins: [i18n], stubs: { ElevationProfileChart: true } },
    });

    // Dacă montarea ar arunca, testul ar cădea aici — și ar spune de ce.
    expect(wrapper.text()).toContain("Harta traseelor");
    expect(wrapper.text()).toContain("Planifică traseu");
    expect(wrapper.text()).toContain("Cabane");

    wrapper.unmount();
  });

  it("pornește harta, îi spune unde e worker-ul și îi forță dimensiunea", async () => {
    // Regresia din 2026-09-24: MapLibre nu-și dă seama singur că containerul s-a așezat, deci fără un
    // `resize()` explicit canvas-ul rămîne 0×0 și ecranul apare gol. Iar fără `setWorkerUrl`, MapLibre
    // își caută worker-ul lîngă chunk — unde nu ajunge niciodată, pentru că bundler-ul nu vede
    // referința. Amîndouă se văd doar într-un browser, deci testul le apără de aici.
    const { default: MapExplorerView } = await import("@/views/MapView.vue");

    const wrapper = mount(MapExplorerView, {
      global: { plugins: [i18n], stubs: { ElevationProfileChart: true } },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.constructed).toBe(1);
    expect(calls.resize).toBeGreaterThan(0);
    expect(calls.workerUrl).toBe("/maplibre-worker/maplibre-gl-worker.mjs");

    wrapper.unmount();
  });

  it("cere ruta de la backend, nu de la un serviciu public", async () => {
    // Regresia pe care o apără: pînă în F3, ecranul chema direct `router.project-osrm.org`, iar pe
    // trasee montane răspunsul era un ocol de zeci de kilometri (docs/F0-MAP-IMPLEMENTATION.md §4).
    const { default: MapExplorerView } = await import("@/views/MapView.vue");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (String(url).includes("/routing/route")) {
        return new Response(
          JSON.stringify({
            distanceMeters: 6347,
            durationSeconds: 4792,
            profile: "foot",
            geometry: [
              [25.4566, 45.4457],
              [25.4645, 45.4028],
            ],
            legs: [
              {
                distanceMeters: 6347,
                durationSeconds: 4792,
                geometry: [
                  [25.4566, 45.4457],
                  [25.4645, 45.4028],
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(MapExplorerView, {
      global: { plugins: [i18n], stubs: { ElevationProfileChart: true } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Pornește planificatorul și pune două puncte, ca un utilizator.
    const plannerButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Planifică traseu"));
    expect(plannerButton).toBeDefined();
    await plannerButton!.trigger("click");

    const click = calls.handlers["click"]?.[0];
    expect(click).toBeTypeOf("function");
    click?.({ lngLat: { lat: 45.4457, lng: 25.4566 } });
    click?.({ lngLat: { lat: 45.4028, lng: 25.4645 } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const routed = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(routed.some((url) => url.includes("/routing/route"))).toBe(true);
    expect(routed.some((url) => url.includes("project-osrm.org"))).toBe(false);
    // Un traseu cu două puncte = o singură cerere, nu una per segment.
    expect(routed.filter((url) => url.includes("/routing/route"))).toHaveLength(1);

    wrapper.unmount();
  });

  it("spune cînd rutarea nu e disponibilă, în loc să se prefacă", async () => {
    // Un eșec de rutare nu are voie să arate ca un traseu calculat: se desenează linii drepte, dar
    // ecranul spune de ce. Înainte, amîndouă cazurile arătau la fel.
    const { default: MapExplorerView } = await import("@/views/MapView.vue");
    vi.stubGlobal(
      "fetch",
      vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
        if (String(url).includes("/routing/route")) {
          return new Response("Rutarea nu e disponibilă acum.", { status: 503 });
        }
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );

    const wrapper = mount(MapExplorerView, {
      global: { plugins: [i18n], stubs: { ElevationProfileChart: true } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const plannerButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Planifică traseu"));
    expect(plannerButton).toBeDefined();
    await plannerButton!.trigger("click");

    const click = calls.handlers["click"]?.[0];
    click?.({ lngLat: { lat: 45.4457, lng: 25.4566 } });
    click?.({ lngLat: { lat: 45.4028, lng: 25.4645 } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(wrapper.text()).toContain("Rutarea nu e disponibilă acum");

    wrapper.unmount();
  });
});
