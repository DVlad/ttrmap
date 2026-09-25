import type { Feature, FeatureCollection, Point } from "geojson";
import type { MountainPoi, MountainPoiCategory } from "@/services/api/mountainPoisApi";

/**
 * Punctele montane ca strat de hartă: culorile pe categorie și conversia în GeoJSON.
 *
 * Culorile stau aici, nu în componentă, pentru că sînt folosite în două locuri (desenarea și legenda)
 * și trebuie să coincidă — o legendă cu altă culoare decît punctul e mai rea decît nicio legendă.
 */

export const POI_CATEGORIES = [
  { key: "hut", color: "#e07a5f" },
  { key: "shelter", color: "#81b29a" },
  { key: "rescue", color: "#e63946" },
  { key: "water", color: "#4dabf7" },
  { key: "viewpoint", color: "#d9a441" },
  { key: "guidepost", color: "#a6b8c2" },
  { key: "warning", color: "#b5179e" },
] as const satisfies ReadonlyArray<{ key: MountainPoiCategory; color: string }>;

export type PoiCategoryKey = (typeof POI_CATEGORIES)[number]["key"];

/**
 * Categoriile care apar ca bifă în panou. `warning` lipsește deliberat **deocamdată**: nu are încă
 * nicio sursă (avertismentele se adaugă din catalog, cu verificare umană — `docs/STUDY-MAP.md` §7.3.3),
 * iar o bifă care nu arată niciodată nimic arată ca o funcție stricată.
 */
export const POI_TOGGLE_CATEGORIES: readonly PoiCategoryKey[] = POI_CATEGORIES.filter(
  (entry) => entry.key !== "warning",
).map((entry) => entry.key);

/** Bifele implicite: ce cauți pe munte. Indicatoarele și belvederele se bifează la cerere. */
export const DEFAULT_ACTIVE_POI_CATEGORIES: readonly PoiCategoryKey[] = [
  "hut",
  "shelter",
  "rescue",
  "water",
];

const FALLBACK_COLOR = "#a6b8c2";

export function poiColor(category: MountainPoiCategory): string {
  return POI_CATEGORIES.find((entry) => entry.key === category)?.color ?? FALLBACK_COLOR;
}

export interface PoiProperties {
  id: number;
  name: string;
  category: MountainPoiCategory;
  color: string;
  /** Contur plin pe hartă = un om a confirmat punctul; estompat = doar citit de la sursă. */
  verified: boolean;
  elevationM: number | null;
  /** Text deja compus pentru popup: atributele utile, una pe linie. */
  details: string;
  notes: string;
  source: string;
  sourceRef: string;
}

export type PoiFeature = Feature<Point, PoiProperties>;
export type PoiCollection = FeatureCollection<Point, PoiProperties>;

/**
 * Punctele active → GeoJSON. `details` se compune o singură dată, aici, ca popup-ul să nu
 * reconstruiască lista la fiecare click.
 */
export function poisToGeoJson(
  pois: readonly MountainPoi[],
  activeCategories: readonly PoiCategoryKey[],
): PoiCollection {
  const features: PoiFeature[] = [];

  for (const poi of pois) {
    if (!activeCategories.includes(poi.category as PoiCategoryKey)) continue;

    const details = Object.values(poi.attributes ?? {}).filter((value) => value.trim() !== "");

    features.push({
      type: "Feature",
      properties: {
        id: poi.id,
        name: poi.name,
        category: poi.category,
        color: poiColor(poi.category),
        verified: poi.isVerified,
        elevationM: poi.elevationM,
        details: details.join(" · "),
        notes: poi.notes ?? "",
        source: poi.source,
        sourceRef: poi.sourceRef,
      },
      geometry: { type: "Point", coordinates: [poi.longitude, poi.latitude] },
    });
  }

  return { type: "FeatureCollection", features };
}
