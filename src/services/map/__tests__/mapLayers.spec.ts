import { describe, expect, it } from "vitest";
import {
  MAP_STYLES,
  OUR_LAYERS,
  OUR_SOURCES,
  mapStyleUrl,
  DEFAULT_MAP_STYLE,
} from "@/services/map/basemap";
import {
  buildOverpassQuery,
  colorForTags,
  overpassToGeoJson,
  parseOsmc,
  TRAIL_FILTERS,
  type OverpassElement,
} from "@/services/map/osmTrails";
import {
  DEFAULT_ACTIVE_POI_CATEGORIES,
  POI_CATEGORIES,
  POI_TOGGLE_CATEGORIES,
  poisToGeoJson,
  poiColor,
} from "@/services/map/poiLayer";
import { plannedRouteToGeoJson, routesToGeoJson } from "@/services/map/routeLayers";
import type { MountainPoi } from "@/services/api/mountainPoisApi";
import type { GpxRoute } from "@/services/gpx/GpxParser";

/**
 * Logica hărții, testată fără hartă.
 *
 * De ce contează: pînă acum conversia traseelor OSM în linii colorate trăia în componentă, amestecată
 * cu desenarea, deci nu putea fi verificată fără un browser. Acum partea care decide **ce** se
 * desenează e pură — iar greșelile de aici se văd pe hartă ca linii lipsă sau de culoarea greșită,
 * exact genul de defect care trece neobservat pînă se plînge cineva.
 */

const BUCEGI = { south: 45.32, west: 25.35, north: 45.48, east: 25.6 };

describe("stilurile de bază", () => {
  it("sînt servite prin https, fără chei de API în URL", () => {
    for (const style of MAP_STYLES) {
      expect(style.url.startsWith("https://")).toBe(true);
      expect(style.url).not.toMatch(/key=|token=|apikey=/i);
    }
  });

  it("stilul implicit există în listă", () => {
    expect(MAP_STYLES.some((style) => style.key === DEFAULT_MAP_STYLE)).toBe(true);
  });

  it("întoarce adresa stilului cerut", () => {
    expect(mapStyleUrl("liberty")).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  it("aruncă la un stil inexistent, în loc să dea hartă albă", () => {
    // @ts-expect-error — verificăm exact cazul unei chei scrise greșit
    expect(() => mapStyleUrl("topo")).toThrow(/necunoscut/);
  });

  it("numele straturilor și surselor noastre nu se suprapun", () => {
    const layers = Object.values(OUR_LAYERS);
    const sources = Object.values(OUR_SOURCES);
    expect(new Set(layers).size).toBe(layers.length);
    expect(new Set(sources).size).toBe(sources.length);
    // Prefixul nostru apără de o coliziune cu straturile stilului de bază (care are 111 layere proprii).
    for (const id of layers) expect(id.startsWith("ttr-")).toBe(true);
  });
});

describe("buildOverpassQuery", () => {
  it("cere relațiile marcate, nu way-urile, pentru `marked`", () => {
    // În România `osmc:symbol` stă pe relație: cerut ca way, traseul marcat nu s-ar găsi deloc.
    const query = buildOverpassQuery(["marked"], BUCEGI);
    // Zona se scrie cu 4 zecimale: Overpass acceptă și mai puține, dar o valoare trunchiată prea
    // agresiv ar muta dreptunghiul sub picioare.
    expect(query).toContain('relation["route"~"hiking|foot"]["osmc:symbol"](45.3200,25.3500,45.4800,25.6000);');
    expect(query).not.toContain("way[");
  });

  it("cere way-uri pentru celelalte filtre", () => {
    const query = buildOverpassQuery(["hiking", "mtb", "cycling"], BUCEGI);
    expect(query).toContain('way["highway"~"path|footway"]["sac_scale"]');
    expect(query).toContain('way["highway"="track"]["mtb:scale"]');
    expect(query).toContain('way["highway"="cycleway"]');
    expect(query).not.toContain("relation[");
  });

  it("fără filtre nu cere nimic", () => {
    expect(buildOverpassQuery([], BUCEGI)).not.toContain("way[");
  });

  it("cere geometria membrilor (`out geom`), altfel nu se poate desena nimic", () => {
    expect(buildOverpassQuery(["marked"], BUCEGI)).toContain("out geom");
  });
});

describe("parseOsmc", () => {
  it("citește culoarea de fond și forma din marcaj", () => {
    const info = parseOsmc("red:white:red_cross");
    expect(info.colorName).toBe("red");
    expect(info.shapeName).toBe("cross");
    expect(info.color).toBe("#d16f72");
  });

  it("acceptă forme cu underscore în nume", () => {
    expect(parseOsmc("blue:white:blue_triangle_turned").shapeName).toBe("triangle_turned");
  });

  it("nu aruncă pe un marcaj neobișnuit", () => {
    expect(parseOsmc("").color).toBe("#a6b8c2");
    expect(parseOsmc("exotic").color).toBe("#a6b8c2");
  });
});

describe("colorForTags", () => {
  it("marcajul are prioritate față de felul drumului", () => {
    expect(colorForTags({ "osmc:symbol": "red:white:red_cross", highway: "path" })).toBe("#d16f72");
  });

  it("recunoaște poteca de hiking, MTB-ul și pista de bicicletă", () => {
    const hiking = TRAIL_FILTERS.find((filter) => filter.key === "hiking")!.color;
    const mtb = TRAIL_FILTERS.find((filter) => filter.key === "mtb")!.color;
    const cycling = TRAIL_FILTERS.find((filter) => filter.key === "cycling")!.color;

    expect(colorForTags({ highway: "path", sac_scale: "hiking" })).toBe(hiking);
    expect(colorForTags({ highway: "track", "mtb:scale": "2" })).toBe(mtb);
    expect(colorForTags({ highway: "cycleway" })).toBe(cycling);
  });

  it("un drum fără nimic special primește culoarea neutră", () => {
    expect(colorForTags({ highway: "track" })).toBe("#a6b8c2");
  });
});

describe("overpassToGeoJson", () => {
  it("desenează fiecare membru al unei relații marcate, cu culoarea relației", () => {
    const elements: OverpassElement[] = [
      {
        type: "relation",
        tags: { "osmc:symbol": "blue:white:blue_stripe", name: "Bandă albastră", network: "lwn" },
        members: [
          { type: "way", geometry: [{ lat: 45.4, lon: 25.4 }, { lat: 45.41, lon: 25.41 }] },
          { type: "way", geometry: [{ lat: 45.41, lon: 25.41 }, { lat: 45.42, lon: 25.42 }] },
          // Un membru fără geometrie (ex. un nod de rol) se sare.
          { type: "node" },
        ],
      },
    ];

    const collection = overpassToGeoJson(elements);

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]!.properties.color).toBe("#8fa3b0");
    expect(collection.features[0]!.properties.relation).toBe(true);
    expect(collection.features[0]!.properties.name).toBe("Bandă albastră");
  });

  it("scrie coordonatele în ordinea GeoJSON: longitudine, latitudine", () => {
    // Inversarea lor e cea mai frecventă greșeală la trecerea de la Leaflet la GeoJSON, iar simptomul
    // e o hartă care pare „mutată în altă țară", nu o eroare.
    const collection = overpassToGeoJson([
      { type: "way", geometry: [{ lat: 45.4, lon: 25.4 }, { lat: 45.41, lon: 25.41 }] },
    ]);

    expect(collection.features[0]!.geometry.coordinates[0]).toEqual([25.4, 45.4]);
  });

  it("sare liniile prea scurte ca să fie desenate", () => {
    const collection = overpassToGeoJson([
      { type: "way", geometry: [{ lat: 45.4, lon: 25.4 }] },
      { type: "way" },
      { type: "way", geometry: [{ lat: 45.4, lon: 25.4 }, { lat: 45.41, lon: 25.41 }] },
    ]);

    expect(collection.features).toHaveLength(1);
  });

  it("păstrează dificultatea și suprafața, pentru popup", () => {
    const collection = overpassToGeoJson([
      {
        type: "way",
        tags: { highway: "path", sac_scale: "mountain_hiking", surface: "ground" },
        geometry: [{ lat: 45.4, lon: 25.4 }, { lat: 45.41, lon: 25.41 }],
      },
    ]);

    expect(collection.features[0]!.properties.sacScale).toBe("mountain_hiking");
    expect(collection.features[0]!.properties.surface).toBe("ground");
  });
});

describe("poisToGeoJson", () => {
  const poi = (overrides: Partial<MountainPoi>): MountainPoi => ({
    id: 1,
    name: "Cabana",
    category: "hut",
    latitude: 45.4,
    longitude: 25.4,
    elevationM: 1500,
    source: "osm",
    sourceRef: "node/1",
    readAt: "2026-09-23T12:00:00Z",
    verifiedAt: null,
    isVerified: false,
    notes: null,
    attributes: null,
    ...overrides,
  });

  it("desenează doar categoriile bifate", () => {
    const collection = poisToGeoJson(
      [poi({ id: 1, category: "hut" }), poi({ id: 2, category: "viewpoint" })],
      ["hut"],
    );

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]!.properties.id).toBe(1);
  });

  it("scrie coordonatele ca [lon, lat] și culoarea categoriei", () => {
    const collection = poisToGeoJson([poi({})], ["hut"]);
    expect(collection.features[0]!.geometry.coordinates).toEqual([25.4, 45.4]);
    expect(collection.features[0]!.properties.color).toBe(poiColor("hut"));
  });

  it("compune atributele într-un singur text, pentru popup", () => {
    const collection = poisToGeoJson(
      [poi({ attributes: { phone: "+40 123", opening_hours: "24/7" } })],
      ["hut"],
    );

    expect(collection.features[0]!.properties.details).toBe("+40 123 · 24/7");
  });

  it("duce mai departe starea de verificare", () => {
    const verified = poisToGeoJson([poi({ isVerified: true })], ["hut"]);
    expect(verified.features[0]!.properties.verified).toBe(true);
  });

  it("fiecare categorie are o culoare, iar `warning` nu e în bifele implicite", () => {
    for (const entry of POI_CATEGORIES) {
      expect(poiColor(entry.key)).toBe(entry.color);
    }
    expect(POI_TOGGLE_CATEGORIES).not.toContain("warning");
    expect(DEFAULT_ACTIVE_POI_CATEGORIES).toEqual(["hut", "shelter", "rescue", "water"]);
  });
});

describe("straturile de rută", () => {
  const route = (points: number, name = "Traseu"): GpxRoute => ({
    name,
    points: Array.from({ length: points }, (_, i) => ({
      lat: 45.4 + i * 0.01,
      lon: 25.4 + i * 0.01,
      alt: 0,
      dist: i * 100,
      grade: 0,
    })),
    totalDistanceMeters: (points - 1) * 100,
    elevationGainMeters: 0,
  });

  it("sare traseele cu mai puțin de două puncte", () => {
    const collection = routesToGeoJson([route(1), route(3)], null);
    expect(collection.features).toHaveLength(1);
  });

  it("marchează traseul selectat, pentru desenare mai groasă", () => {
    const collection = routesToGeoJson([route(3, "A"), route(3, "B")], 1);
    expect(collection.features.map((feature) => feature.properties.selected)).toEqual([false, true]);
  });

  it("nu desenează un traseu planificat fără linie", () => {
    expect(plannedRouteToGeoJson([{ lat: 45.4, lon: 25.4 }], 1)).toBeNull();
    expect(plannedRouteToGeoJson([], 0)).toBeNull();
  });

  it("desenează traseul planificat și păstrează numărul de puncte alese", () => {
    const feature = plannedRouteToGeoJson(
      [{ lat: 45.4, lon: 25.4 }, { lat: 45.5, lon: 25.5 }],
      2,
    );

    expect(feature?.properties.waypointCount).toBe(2);
    expect(feature?.geometry.coordinates).toEqual([[25.4, 45.4], [25.5, 45.5]]);
  });
});
