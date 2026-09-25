import { MAP_API_BASE } from "@/utils/apiBase";

/**
 * Punctele montane — cabane, refugii, posturi Salvamont, izvoare, belvedere, indicatoare.
 *
 * <para>
 * Se citesc din **baza noastră**, nu din OSM: măsurat pe 2026-09-23, o singură cerere Overpass pentru
 * un masiv a luat ~178 de secunde, iar mirror-ul principal a răspuns 504. Importul rulează separat, ca
 * operație de administrator (`docs/F0-MAP-IMPLEMENTATION.md` §2.2).
 * </para>
 */

export const MOUNTAIN_POI_CATEGORIES = [
  "hut",
  "shelter",
  "rescue",
  "water",
  "viewpoint",
  "guidepost",
  "warning",
] as const;

export type MountainPoiCategory = (typeof MOUNTAIN_POI_CATEGORIES)[number];

export interface MountainPoi {
  id: number;
  name: string;
  category: MountainPoiCategory;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  source: string;
  sourceRef: string;
  readAt: string;
  verifiedAt: string | null;
  /** Un om a confirmat rîndul, nu doar l-am citit de la sursă. */
  isVerified: boolean;
  notes: string | null;
  attributes: Record<string, string> | null;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Cît de mare poate fi dreptunghiul cerut — aceeași regulă ca pe backend (`MountainPoiPolicy`). */
export const MAX_POI_BBOX_SPAN_DEGREES = 10;

/** Sub atîtea caractere nu se cheamă serverul: căutarea se face la fiecare tastă apăsată. */
export const MIN_POI_SEARCH_LENGTH = 2;

const BASE = `${MAP_API_BASE}/mountain-pois`;

function bboxQuery(bounds: Bounds): string {
  return [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(5))
    .join(",");
}

/**
 * Punctele dintr-un dreptunghi. `categories` gol înseamnă „toate".
 *
 * Aruncă la eroare: ecranul are un loc unde o poate spune, iar o listă goală care ascunde o eroare de
 * rețea e exact tiparul de „eșec tăcut" care a făcut planificatorul să afișeze un D+ inventat
 * (`docs/STUDY-MAP.md` §3.1.1).
 */
export async function fetchMountainPois(
  bounds: Bounds,
  categories: readonly MountainPoiCategory[] = [],
  signal?: AbortSignal,
): Promise<MountainPoi[]> {
  const params = new URLSearchParams({ bbox: bboxQuery(bounds) });
  if (categories.length > 0) params.set("categories", categories.join(","));

  const res = await fetch(`${BASE}?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`GET mountain-pois failed: ${res.status}`);
  }

  return (await res.json()) as MountainPoi[];
}

/**
 * Caută puncte după nume, în **toată baza** — nu doar în ce e pe ecran. De aceea e utilă: găsești
 * „Cabana Omu" fără să știi în ce parte a țării e.
 *
 * Un text prea scurt întoarce listă goală fără să cheme serverul (aceeași regulă ca pe backend, care
 * răspunde oricum cu listă goală) — altfel fiecare tastă apăsată ar însemna un request.
 */
export async function searchMountainPois(
  query: string,
  signal?: AbortSignal,
): Promise<MountainPoi[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_POI_SEARCH_LENGTH) return [];

  const params = new URLSearchParams({ q: trimmed });
  const res = await fetch(`${BASE}/search?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`GET mountain-pois/search failed: ${res.status}`);
  }

  return (await res.json()) as MountainPoi[];
}
