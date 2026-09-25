import type { LatLon } from "@/utils/trailStats";
import { sampleEvenlyWithDistances } from "@/utils/trailStats";

/**
 * Profilul altimetric al unui traseu planificat — seria de puncte pentru grafic și estimarea de durată.
 *
 * Modul pur: primește geometria și altitudinile, întoarce o serie. Fără hartă, fără DOM, fără rețea —
 * exact partea care se poate testa și care, dacă greșește, desenează o urcare care nu există.
 */

export interface ProfilePoint {
  /** Distanța de la start, în metri. */
  distanceM: number;
  elevationM: number;
}

export interface ElevationProfile {
  points: ProfilePoint[];
  /** Cîte puncte au altitudine cunoscută din cele cerute. */
  known: number;
  requested: number;
  minElevationM: number | null;
  maxElevationM: number | null;
  totalDistanceM: number;
}

/**
 * Serie de profil din geometrie + altitudinile eșantioanelor.
 *
 * Punctele fără altitudine **se scot din serie**, nu se pun la zero: linia ar sări la nivelul mării și
 * înapoi, adică exact graficul acela care arată ca o prăpastie acolo unde de fapt nu știm altitudinea.
 * Cînd un punct lipsește, graficul leagă punctele cunoscute vecine — o aproximare vizibilă, dar onestă.
 */
export function buildElevationProfile(
  distancesM: readonly number[],
  elevations: readonly (number | null)[],
): ElevationProfile {
  const points: ProfilePoint[] = [];

  const count = Math.min(distancesM.length, elevations.length);
  for (let i = 0; i < count; i++) {
    const elevation = elevations[i];
    const distance = distancesM[i];
    if (elevation === null || elevation === undefined || !Number.isFinite(elevation)) continue;
    if (distance === undefined || !Number.isFinite(distance)) continue;
    points.push({ distanceM: distance, elevationM: elevation });
  }

  const values = points.map((point) => point.elevationM);
  const lastDistance = distancesM[distancesM.length - 1];

  return {
    points,
    known: points.length,
    requested: count,
    minElevationM: values.length > 0 ? Math.min(...values) : null,
    maxElevationM: values.length > 0 ? Math.max(...values) : null,
    totalDistanceM: typeof lastDistance === "number" && Number.isFinite(lastDistance) ? lastDistance : 0,
  };
}

/**
 * Cît durează un traseu pe jos, din distanță și urcuș — model tip Naismith.
 *
 * E o **estimare de planificare**, nu o predicție: merge pe viteză constantă pe plat plus o oră pentru
 * fiecare urcuș, exact cum fac ghidurile de munte cînd scriu „6–7 ore" pe fișa unui traseu. Nu ține
 * cont de teren (piatră, grohotiș), de coborîș (care obosește și el) sau de pauze — de aceea textul din
 * ecran spune „estimat", iar cifra se rotunjește la 5 minute, ca să nu pară exactă.
 */
export const HIKING_FLAT_SPEED_KMH = 4.2;
export const HIKING_ASCENT_M_PER_HOUR = 350;

export function estimateHikingMinutes(distanceM: number, gainM: number): number | null {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  if (!Number.isFinite(gainM) || gainM < 0) return null;

  const minutes = (distanceM / 1000 / HIKING_FLAT_SPEED_KMH) * 60 + (gainM / HIKING_ASCENT_M_PER_HOUR) * 60;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  // Rotunjit la 5 minute: o precizie de minut ar sugera o exactitate pe care modelul nu o are.
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/** Eșantionează geometria și pregătește perechile (distanță, altitudine) pentru profil. */
export function profileSamples(
  geometry: readonly LatLon[],
  maxPoints: number,
): { points: LatLon[]; distancesM: number[] } {
  return sampleEvenlyWithDistances(geometry, maxPoints);
}
