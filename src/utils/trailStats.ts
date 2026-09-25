import { haversineMeters } from "@/services/geo/geoMath";
import type { GpxPoint, GpxRoute } from "@/services/gpx/GpxParser";

/**
 * Socoteala unui traseu **planificat** (nu importat): distanța segmentelor și transformarea lui în
 * `GpxRoute`, ca să poată fi salvat, exportat sau trimis în ride.
 *
 * De ce stă separat de ecran: planificatorul din `MapExplorerView` recalculează distanța la fiecare
 * click, la fiecare tragere de punct și la fiecare „anulează ultimul". Ținînd regula aici, poate fi
 * testată fără hartă, fără DOM și fără rețea — exact tiparul cerut în `docs/STUDY-MAP.md` §5.4.
 */

/** Un punct geografic, independent de biblioteca de hărți (`L.LatLng` are `lng`, nu `lon`). */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Distanța cumulată a unei polilinii (metri). Sub două puncte întoarce zero. */
export function polylineDistanceMeters(points: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    // `noUncheckedIndexedAccess`: un punct lipsă nu are voie să arunce, doar să nu contribuie.
    if (!from || !to) continue;
    total += haversineMeters(from.lat, from.lon, to.lat, to.lon);
  }
  return total;
}

/** Distanța totală a unui traseu planificat, însumînd segmentele lui (un segment = o rută între două puncte). */
export function segmentsDistanceMeters(segments: readonly (readonly LatLon[])[]): number {
  let total = 0;
  for (const segment of segments) total += polylineDistanceMeters(segment);
  return total;
}

/**
 * Trage segmentele consecutive într-o singură geometrie, **fără să dubleze punctul de legătură**:
 * două segmente vecine împart punctul dintre ele, iar repetarea lui ar adăuga un punct cu distanță
 * zero (și ar strica gradientul calculat mai tîrziu, care împarte la distanță).
 */
export function joinSegments(segments: readonly (readonly LatLon[])[]): LatLon[] {
  const joined: LatLon[] = [];
  for (const segment of segments) {
    for (const point of segment) {
      const last = joined[joined.length - 1];
      if (last && last.lat === point.lat && last.lon === point.lon) continue;
      joined.push({ lat: point.lat, lon: point.lon });
    }
  }
  return joined;
}

/**
 * Ia cel mult `max` puncte, uniform distanțate pe geometrie — **inclusiv primul și ultimul** — și
 * întoarce și **distanța cumulată** la fiecare punct ales.
 *
 * De ce distanțele: profilul altimetric are nevoie de o axă X corectă. Dacă le-am calcula pe
 * eșantionul de 100 de puncte, axa ar arăta mai puțin decît distanța reală afișată lîngă ea, iar cele
 * două cifre s-ar contrazice sub ochii utilizatorului. Distanțele se iau deci pe geometria **întreagă**.
 */
export function sampleEvenlyWithDistances(
  points: readonly LatLon[],
  max: number,
): { points: LatLon[]; distancesM: number[] } {
  if (max <= 0 || points.length === 0) return { points: [], distancesM: [] };

  // Distanța cumulată pe toată geometria, o singură dată.
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    cumulative.push(
      (cumulative[i - 1] ?? 0) + (from && to ? haversineMeters(from.lat, from.lon, to.lat, to.lon) : 0),
    );
  }

  if (points.length <= max) {
    return { points: [...points], distancesM: cumulative };
  }

  // Un singur punct cerut: începutul. (Fără cazul asta, `step` ar fi infinit și indexul `NaN`.)
  if (max === 1) {
    return { points: [points[0]!], distancesM: [0] };
  }

  const step = (points.length - 1) / (max - 1);
  const sampledPoints: LatLon[] = [];
  const sampledDistances: number[] = [];

  for (let i = 0; i < max; i++) {
    const index = Math.round(i * step);
    const point = points[index];
    if (!point) continue;
    sampledPoints.push(point);
    sampledDistances.push(cumulative[index] ?? 0);
  }

  return { points: sampledPoints, distancesM: sampledDistances };
}

/**
 * Ia cel mult `max` puncte, uniform distanțate pe geometrie — **inclusiv primul și ultimul**.
 *
 * De ce: o rută de planificator are ușor peste o mie de puncte, iar sursa de altitudine acceptă 100.
 * Eșantionarea uniformă păstrează forma urcărilor (un traseu care urcă și coboară de trei ori nu se
 * poate „netezi" la o singură pantă), iar capetele contează pentru încadrare.
 */
export function sampleEvenly(points: readonly LatLon[], max: number): LatLon[] {
  return sampleEvenlyWithDistances(points, max).points;
}

/**
 * Urcat și coborît cumulate dintr-o serie de altitudini.
 *
 * `null` înseamnă „nu știm altitudinea acolo": punctul **nu** se numără ca zero și **nu** rupe seria —
 * altfel o singură citire lipsă ar arăta ca o prăpastie de 2 000 m. Perechile în care lipsește oricare
 * capăt se sar, iar dacă rămîn mai puțin de două valori bune, rezultatul e „necunoscut".
 */
export function elevationGainLoss(elevations: readonly (number | null)[]): {
  gainM: number | null;
  lossM: number | null;
  known: number;
} {
  let gain = 0;
  let loss = 0;
  let known = 0;
  let previous: number | null = null;

  for (const value of elevations) {
    if (value === null || !Number.isFinite(value)) continue;
    known++;
    if (previous !== null) {
      const delta = value - previous;
      if (delta > 0) gain += delta;
      else loss += Math.abs(delta);
    }
    previous = value;
  }

  return known >= 2
    ? { gainM: gain, lossM: loss, known }
    : { gainM: null, lossM: null, known };
}

/**
 * Traseul planificat → `GpxRoute`, forma pe care o știu deja store-ul de trasee, API-ul și ride-ul.
 *
 * **Altitudinea e zero, deliberat.** Backend-ul nu servește încă o sursă de altitudine
 * (`/api/elevation` nu există — `docs/STUDY-MAP.md` §3.1.1), deci `alt` și `grade` rămîn `0`, iar
 * `elevationGainMeters` la fel. Nu inventăm o cifră ca să arate bine: consecința, spusă și în UI, e
 * că un traseu planificat are profil plat pînă cînd altitudinea vine din DEM propriu (F2).
 */
export function buildPlannedRoute(name: string, points: readonly LatLon[]): GpxRoute {
  const gpxPoints: GpxPoint[] = [];
  let cumulative = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    if (i > 0) {
      const previous = points[i - 1];
      if (previous) {
        cumulative += haversineMeters(previous.lat, previous.lon, point.lat, point.lon);
      }
    }
    gpxPoints.push({ lat: point.lat, lon: point.lon, alt: 0, dist: cumulative, grade: 0 });
  }

  return {
    name: name.trim(),
    points: gpxPoints,
    totalDistanceMeters: cumulative,
    elevationGainMeters: 0,
  };
}
