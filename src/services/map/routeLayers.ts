import type { Feature, FeatureCollection, LineString } from "geojson";
import type { GpxRoute } from "@/services/gpx/GpxParser";
import type { LatLon } from "@/utils/trailStats";

/**
 * Liniile de rută ale ecranului de hartă: traseele mele și traseul planificat.
 *
 * De ce într-un modul propriu: harta nu ține minte ce a desenat, ci primește un GeoJSON nou la fiecare
 * schimbare. Compunerea acelui GeoJSON e logică pură — se testează fără hartă, iar ecranul rămîne cu
 * cablul.
 */

export interface RouteProperties {
  id: number | null;
  name: string;
  distanceKm: number;
  elevationGainM: number;
  /** Traseul selectat în listă se desenează mai gros. */
  selected: boolean;
}

export type RouteCollection = FeatureCollection<LineString, RouteProperties>;

export interface PlannedRouteProperties {
  /** Numărul de puncte interogate — util la depanat „de ce nu văd linia". */
  waypointCount: number;
}

export type PlannedRouteFeature = Feature<LineString, PlannedRouteProperties>;

function toCoordinates(points: readonly LatLon[]): [number, number][] {
  // GeoJSON vrea [lon, lat].
  return points.map((point) => [point.lon, point.lat]);
}

/**
 * Traseele utilizatorului → GeoJSON. Traseele cu mai puțin de două puncte se **sar**: o linie cu un
 * singur punct nu se poate desena, iar MapLibre aruncă la geometrii invalide.
 */
export function routesToGeoJson(
  routes: readonly GpxRoute[],
  selectedIndex: number | null,
): RouteCollection {
  const features: Feature<LineString, RouteProperties>[] = [];

  routes.forEach((route, index) => {
    if (route.points.length < 2) return;
    features.push({
      type: "Feature",
      properties: {
        id: route.id ?? null,
        name: route.name,
        distanceKm: route.totalDistanceMeters / 1000,
        elevationGainM: route.elevationGainMeters,
        selected: index === selectedIndex,
      },
      geometry: {
        type: "LineString",
        coordinates: toCoordinates(route.points.map((point) => ({ lat: point.lat, lon: point.lon }))),
      },
    });
  });

  return { type: "FeatureCollection", features };
}

/** Traseul planificat → GeoJSON, sau `null` cînd nu există încă o linie de desenat. */
export function plannedRouteToGeoJson(points: readonly LatLon[], waypointCount: number): PlannedRouteFeature | null {
  if (points.length < 2) return null;

  return {
    type: "Feature",
    properties: { waypointCount },
    geometry: { type: "LineString", coordinates: toCoordinates(points) },
  };
}
