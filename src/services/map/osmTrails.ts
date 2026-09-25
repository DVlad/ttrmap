import type { Feature, FeatureCollection, LineString } from "geojson";

/**
 * Traseele din OpenStreetMap — interogarea și transformarea în GeoJSON.
 *
 * Tot ce e aici e **pur**: fără rețea, fără hartă, fără DOM. Ecranul cheamă Overpass-ul (sau cache-ul
 * de pe backend) și dă rezultatul acestor funcții, care pot fi testate pe răspunsuri reale.
 *
 * De ce s-a mutat din componentă: în `MapExplorerView.vue` logica asta stătea amestecată cu desenarea
 * (mii de `L.polyline`), deci nu putea fi testată fără o hartă. La trecerea pe tile-uri vectoriale,
 * desenarea devine o **stilizare**, iar partea care decide *ce* se desenează rămîne aici.
 */

export const TRAIL_FILTERS = [
  // Trasee cu marcaj oficial (bandă, cruce, punct etc.)
  { key: "marked", labelKey: "map.filters.marked", color: "#6e9c8d", wayFilter: '["osmc:symbol"]' },
  // Poteci de hiking/footway cu dificultate SAC sau highway=path
  {
    key: "hiking",
    labelKey: "map.filters.hiking",
    color: "#c98a3e",
    wayFilter: '["highway"~"path|footway"]["sac_scale"]',
  },
  // MTB — doar trackuri cu rating MTB explicit (nu drumuri forestiere oarecare)
  { key: "mtb", labelKey: "map.filters.mtb", color: "#8fa3b0", wayFilter: '["highway"="track"]["mtb:scale"]' },
  { key: "cycling", labelKey: "map.filters.cycling", color: "#9c7ea6", wayFilter: '["highway"="cycleway"]' },
] as const;

export type TrailFilterKey = (typeof TRAIL_FILTERS)[number]["key"];

export interface TrailBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Interogarea Overpass pentru filtrele active.
 *
 * Traseele marcate din România au `osmc:symbol` pe **relație**, nu pe way: de aceea ele se cer ca
 * relații cu `out geom` (membrii vin cu geometrie), iar restul rămîn interogări de way-uri, mai
 * rapide. Ordinea contează — relația se desenează colorată după marcajul ei, nu după felul drumului.
 */
export function buildOverpassQuery(filters: readonly TrailFilterKey[], bounds: TrailBounds): string {
  const box = [
    bounds.south.toFixed(4),
    bounds.west.toFixed(4),
    bounds.north.toFixed(4),
    bounds.east.toFixed(4),
  ].join(",");

  const active = TRAIL_FILTERS.filter((filter) => filters.includes(filter.key));
  const parts = active.map((filter) =>
    filter.key === "marked"
      ? `relation["route"~"hiking|foot"]["osmc:symbol"](${box});`
      : `way${filter.wayFilter}(${box});`,
  );

  return `
    [out:json][timeout:25];
    (
      ${parts.join("\n      ")}
    );
    out geom qt;
  `;
}

// ── Marcajul (osmc:symbol) ─────────────────────────────────────────────────

/** Culorile din `osmc:symbol`, așa cum apar în teren. */
const OSMC_COLOR_MAP: Record<string, string> = {
  red: "#d16f72",
  blue: "#8fa3b0",
  green: "#6e9c8d",
  yellow: "#d9a441",
  black: "#1b1f24",
  white: "#f7f5f2",
  orange: "#c98a3e",
  violet: "#9c7ea6",
  brown: "#6d4e1b",
};

export interface OsmcInfo {
  /** Culoarea marcajului (pentru legendă și popup). */
  color: string;
  /** Culoarea poliliniei pe hartă — culoarea de fond a marcajului. */
  wayColor: string;
  /** Numele culorii, ca text (ex. „red") — eticheta tradusă se compune în ecran. */
  colorName: string;
  /** Forma, ca text (ex. „cross") — la fel, tradusă în ecran. */
  shapeName: string;
}

/** `osmc:symbol` → culoare și formă. Format: `waycolor:background:foreground[:text[:textcolor]]`. */
export function parseOsmc(symbol: string): OsmcInfo {
  const parts = symbol.split(":");
  const wayColorKey = parts[0] ?? "";
  const fgPart = parts[2] ?? "";

  const fgParts = fgPart.split("_");
  const fgColor = fgParts[0] ?? "";
  const shapeName = fgParts.slice(1).join("_");

  const color = OSMC_COLOR_MAP[fgColor] ?? OSMC_COLOR_MAP[wayColorKey] ?? "#a6b8c2";
  const wayColor = OSMC_COLOR_MAP[wayColorKey] ?? color;

  return { color, wayColor, colorName: fgColor || wayColorKey, shapeName };
}

/** Culoarea unei linii, după marcaj sau după felul drumului. */
export function colorForTags(tags: Record<string, string>): string {
  const osmc = tags["osmc:symbol"];
  if (osmc) return parseOsmc(osmc).wayColor;

  const highway = tags["highway"] ?? "";
  if ((highway === "path" || highway === "footway") && tags["sac_scale"]) {
    return TRAIL_FILTERS.find((filter) => filter.key === "hiking")!.color;
  }
  if (highway === "track" && tags["mtb:scale"]) {
    return TRAIL_FILTERS.find((filter) => filter.key === "mtb")!.color;
  }
  if (highway === "cycleway") return TRAIL_FILTERS.find((filter) => filter.key === "cycling")!.color;
  return "#a6b8c2";
}

// ── Răspunsul Overpass ─────────────────────────────────────────────────────

export interface OverpassMember {
  type: string;
  role?: string;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OverpassElement {
  type: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: OverpassMember[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

/** Proprietățile puse pe fiecare linie din GeoJSON (citite de stil și de popup). */
export interface TrailProperties {
  color: string;
  name: string;
  /** Eticheta marcajului, brută (`osmc:symbol`); ecranul o traduce. */
  osmc: string;
  network: string;
  sacScale: string;
  mtbScale: string;
  surface: string;
  distance: string;
  /** `true` pentru traseele care vin din relații marcate. */
  relation: boolean;
}

export type TrailFeature = Feature<LineString, TrailProperties>;
export type TrailCollection = FeatureCollection<LineString, TrailProperties>;

function line(coordinates: [number, number][], properties: TrailProperties): TrailFeature {
  return { type: "Feature", properties, geometry: { type: "LineString", coordinates } };
}

function toCoordinates(geometry: Array<{ lat: number; lon: number }>): [number, number][] {
  // GeoJSON vrea [lon, lat] — invers față de cum vin datele din Overpass și din Leaflet.
  return geometry.map((point) => [point.lon, point.lat]);
}

/**
 * Răspunsul Overpass → GeoJSON.
 *
 * Fiecare membru al unei relații marcate devine o linie proprie, colorată după marcajul **relației**
 * (nu al way-ului). GeoJSON-ul rezultat e desenat de MapLibre ca **un singur strat**, indiferent cîte
 * mii de linii conține — exact problema pe care o avea varianta cu un obiect Leaflet per way.
 */
export function overpassToGeoJson(elements: readonly OverpassElement[]): TrailCollection {
  const features: TrailFeature[] = [];

  for (const element of elements) {
    if (element.type === "relation" && element.members) {
      const tags = element.tags ?? {};
      const color = tags["osmc:symbol"] ? parseOsmc(tags["osmc:symbol"]).wayColor : "#6e9c8d";
      const base: TrailProperties = {
        color,
        name: tags["name"] ?? tags["ref"] ?? "",
        osmc: tags["osmc:symbol"] ?? "",
        network: tags["network"] ?? "",
        sacScale: tags["sac_scale"] ?? "",
        mtbScale: tags["mtb:scale"] ?? "",
        surface: tags["surface"] ?? "",
        distance: tags["distance"] ?? "",
        relation: true,
      };

      for (const member of element.members) {
        if (member.type !== "way" || !member.geometry || member.geometry.length < 2) continue;
        features.push(line(toCoordinates(member.geometry), base));
      }
      continue;
    }

    if (element.type !== "way" || !element.geometry || element.geometry.length < 2) continue;

    const tags = element.tags ?? {};
    features.push(
      line(toCoordinates(element.geometry), {
        color: colorForTags(tags),
        name: tags["name"] ?? tags["ref"] ?? "",
        osmc: tags["osmc:symbol"] ?? "",
        network: tags["network"] ?? "",
        sacScale: tags["sac_scale"] ?? "",
        mtbScale: tags["mtb:scale"] ?? "",
        surface: tags["surface"] ?? "",
        distance: tags["distance"] ?? "",
        relation: false,
      }),
    );
  }

  return { type: "FeatureCollection", features };
}
