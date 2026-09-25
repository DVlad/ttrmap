import { API_BASE } from "@/utils/apiBase";
import type { LatLon } from "@/utils/trailStats";

/**
 * Rutarea din planificator, de la backend — care o cere motorului nostru (Valhalla).
 *
 * De ce nu direct de la un serviciu public, cum era înainte: ecranul chema
 * `router.project-osrm.org` cu profilul `foot`, iar pe trasee montane reale rezultatul era ocolul.
 * Măsurat pe 2026-09-24 (`docs/F0-MAP-IMPLEMENTATION.md` §4): între Azuga și Cabana Diham, OSRM a
 * răspuns 41 km în loc de 6,2 km, iar 0% din rută stătea pe traseul marcat. Valhalla a stat pe traseu
 * 100% și a răspuns în 4–263 ms.
 */

/** Profilurile de mers, exact cele pe care le știe backend-ul (`RoutePlanPolicy.TryParseProfile`). */
export type TravelProfile = "foot" | "bike" | "mtb";

/** O etapă a traseului: ce e între două puncte consecutive alese de utilizator. */
export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
  /** Geometria etapei, în ordinea `[lon, lat]`. */
  geometry: [number, number][];
}

export interface RoutePlan {
  distanceMeters: number;
  durationSeconds: number;
  profile: TravelProfile;
  /** Geometria întreagă, în ordinea `[lon, lat]` (GeoJSON). */
  geometry: [number, number][];
  /** Etapele, în ordine — planificatorul le ține separate ca „anulează ultimul" să știe ce cade. */
  legs: RouteLeg[];
}

/** Cîte puncte se cer odată — aceeași limită ca pe backend (`RoutePlanPolicy.MaxWaypoints`). */
export const MAX_ROUTE_WAYPOINTS = 25;

/**
 * Profilurile oferite în planificator, în ordinea din listă. Etichetele se construiesc din chei
 * (`t(profile.labelKey)`), deci adăugarea unui profil fără traducere ar apărea ca **cheie brută** pe
 * ecran; `mapKeys.spec.ts` păzește exact asta.
 */
export const TRAVEL_PROFILES = [
  { key: "foot", labelKey: "map.travelProfile.foot" },
  { key: "bike", labelKey: "map.travelProfile.bike" },
  { key: "mtb", labelKey: "map.travelProfile.mtb" },
] as const satisfies readonly { key: TravelProfile; labelKey: string }[];

/** Ruta prin punctele date, în ordine. Aruncă la eroare: ecranul are unde s-o spună. */
export async function fetchRoute(
  points: readonly LatLon[],
  profile: TravelProfile = "foot",
  signal?: AbortSignal,
): Promise<RoutePlan> {
  if (points.length < 2) throw new Error("Rutarea are nevoie de cel puțin două puncte.");

  const res = await fetch(`${API_BASE}/routing/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points: points.slice(0, MAX_ROUTE_WAYPOINTS).map((point) => ({
        latitude: point.lat,
        longitude: point.lon,
      })),
      profile,
    }),
    signal,
  });

  if (!res.ok) {
    // Corpul răspunsului e un mesaj citibil scris de backend („Rutarea nu e disponibilă acum…"),
    // nu un cod. Îl păstrăm, ca ecranul să poată spune ce s-a întîmplat.
    const detail = await res.text().catch(() => "");
    throw new Error(detail.trim() || `POST routing/route failed: ${res.status}`);
  }

  return (await res.json()) as RoutePlan;
}

/** Geometria, ca listă de puncte `LatLon` pentru restul aplicației. */
export function routeGeometry(plan: RoutePlan): LatLon[] {
  return plan.geometry.map(([lon, lat]) => ({ lat, lon }));
}
