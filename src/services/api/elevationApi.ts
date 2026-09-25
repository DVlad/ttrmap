import { API_BASE } from "@/utils/apiBase";
import type { LatLon } from "@/utils/trailStats";

/**
 * Altitudinile, de la backend — care le citește din DEM-ul Copernicus GLO-30.
 *
 * De ce prin backend și nu direct dintr-un serviciu public: citirea cere cereri parțiale `Range`
 * într-un GeoTIFF cu predictor pentru virgulă mobilă (`docs/STUDY-MAP.md` §9, F2), lucru pe care
 * browserul nu-l face, plus un cache pe tile-uri care altfel s-ar plăti la fiecare editare de traseu.
 * Măsurat: 1,9 s pentru 7 puncte la rece, 0,05 s din cache.
 */

export interface ElevationResult {
  latitude: number;
  longitude: number;
  /** `null` = nu o știm (în afara acoperirii DEM sau sursă indisponibilă). Nu e zero. */
  elevation: number | null;
}

/** Cîte puncte se cerodată — aceeași limită ca pe backend (`ElevationPolicy.MaxLocations`). */
export const MAX_ELEVATION_POINTS = 100;

/**
 * Altitudinea fiecărui punct, în ordinea cerută. Aruncă la eroare: ecranul are unde s-o spună, iar un
 * D+ calculat din date lipsă ar fi exact minciuna pe care am scos-o în F1.
 */
export async function fetchElevations(
  points: readonly LatLon[],
  signal?: AbortSignal,
): Promise<ElevationResult[]> {
  if (points.length === 0) return [];

  const locations = points
    .slice(0, MAX_ELEVATION_POINTS)
    .map((point) => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`)
    .join("|");

  const res = await fetch(`${API_BASE}/elevation?locations=${encodeURIComponent(locations)}`, {
    signal,
  });
  if (!res.ok) throw new Error(`GET elevation failed: ${res.status}`);

  const data = (await res.json()) as { results: ElevationResult[] };
  return data.results;
}
