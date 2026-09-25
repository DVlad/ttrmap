import { describe, expect, it } from "vitest";
import catalogRo from "@/locales/ro";
import catalogEn from "@/locales/en";
import catalogFr from "@/locales/fr";
import {
  MOUNTAIN_POI_CATEGORIES,
  type MountainPoiCategory,
} from "@/services/api/mountainPoisApi";
import { MAP_STYLES } from "@/services/map/basemap";
import { TRAIL_FILTERS } from "@/services/map/osmTrails";
import { TRAVEL_PROFILES } from "@/services/api/routingApi";

/**
 * Cheile **dinamice** ale ecranului de hartă, verificate în toate cataloagele.
 *
 * De ce e nevoie de testul ăsta cînd există deja `usedTranslationKeys.spec.ts`: gardul acela caută
 * doar chei scrise literal (`t("map.poi.title")`), iar ecranul construiește etichetele din cod —
 * `t(\`map.poi.${category}\`)`, `t(ft.labelKey)`, `t(tl.labelKey)`. O categorie nouă, un filtru nou sau
 * un strat nou ar apărea pe ecran ca **cheie brută**, iar niciun test generic n-ar vedea-o (paritatea
 * între limbi nu ajută: cheia poate lipsi din toate).
 *
 * Hărțile de mai jos sînt **exhaustive față de tipuri**: dacă backend-ul capătă o categorie nouă,
 * fișierul nu mai compilează pînă nu i se adaugă traducerea.
 */

const POI_CATEGORY_KEYS: Record<MountainPoiCategory, true> = {
  hut: true,
  shelter: true,
  rescue: true,
  water: true,
  viewpoint: true,
  guidepost: true,
  warning: true,
};

/** Cheile statice ale panoului de puncte (aceleași pe care le vede gardul de chei literale). */
const POI_STATIC_KEYS = [
  "title",
  "loading",
  "empty",
  "unavailable",
  "verified",
  "unverified",
  "elevation",
  "source",
];

/**
 * Etichetele construite din listele de constante ale ecranului: filtrele de trasee (`TRAIL_FILTERS`),
 * straturile de hartă (`MAP_STYLES`) și categoriile de puncte (`POI_CATEGORIES`). Trebuie ținute
 * sincron cu modulele din `src/services/map/` — de aceea listele sînt aici, explicite: o cheie
 * adăugată acolo și uitată aici nu are alt gard.
 */
const FILTER_KEYS = ["marked", "hiking", "mtb", "cycling"];
const LAYER_KEYS = ["liberty", "bright", "positron", "dark"];
/** Cheile statice ale ecranului, folosite direct în template. */
const SCREEN_KEYS = ["webglUnavailable", "styleUnavailable"];

const CATALOGS: Record<string, unknown> = { ro: catalogRo, en: catalogEn, fr: catalogFr };

function valueAt(catalog: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (typeof node !== "object" || node === null) return undefined;
    return (node as Record<string, unknown>)[part];
  }, catalog);
}

function missingKeys(prefix: string, keys: readonly string[]): string[] {
  const missing: string[] = [];
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    for (const key of keys) {
      const value = valueAt(catalog, `${prefix}.${key}`);
      if (typeof value !== "string" || value.trim() === "") missing.push(`${locale}: ${key}`);
    }
  }
  return missing;
}

describe("cheile ecranului de hartă", () => {
  it("catalogul de categorii acoperă exact ce poate întoarce API-ul", () => {
    // Dacă lista de categorii din client rămîne în urma backend-ului, punctele de tip nou nu se
    // desenează — și nu se vede nicio eroare, doar lipsesc de pe hartă.
    expect(Object.keys(POI_CATEGORY_KEYS).sort()).toEqual([...MOUNTAIN_POI_CATEGORIES].sort());
  });

  it("cheile statice ale punctelor montane există, cu text, în toate limbile", () => {
    expect(missingKeys("map.poi", POI_STATIC_KEYS)).toEqual([]);
  });

  it("fiecare categorie de punct are etichetă în toate limbile", () => {
    expect(missingKeys("map.poi", Object.keys(POI_CATEGORY_KEYS))).toEqual([]);
  });

  it("fiecare filtru de trasee are etichetă în toate limbile", () => {
    expect(missingKeys("map.filters", FILTER_KEYS)).toEqual([]);
  });

  it("fiecare strat de hartă are etichetă în toate limbile", () => {
    expect(missingKeys("map.layers", LAYER_KEYS)).toEqual([]);
  });

  it("cheile statice ale ecranului există, cu text, în toate limbile", () => {
    expect(missingKeys("map", SCREEN_KEYS)).toEqual([]);
  });

  it("cheile căutării și ale poziției există, cu text, în toate limbile", () => {
    expect(missingKeys("map.search", ["label", "placeholder", "empty", "unavailable"])).toEqual([]);
    expect(
      missingKeys("map.locate", ["button", "title", "locating", "denied", "unavailable", "unsupported"]),
    ).toEqual([]);
    expect(
      missingKeys("map.profile", ["title", "chartLabel", "estimated", "partial"]),
    ).toEqual([]);
  });

  it("fiecare profil de mers are etichetă în toate limbile", () => {
    expect(missingKeys("map.travelProfile", ["label", ...TRAVEL_PROFILES.map((p) => p.key)])).toEqual(
      [],
    );
    expect(missingKeys("map", ["routingUnavailable"])).toEqual([]);
  });

  it("listele din test acoperă exact constantele ecranului", () => {
    // Dacă cineva adaugă un strat ori un filtru, testul cade pînă îi adaugă traducerea — asta e tot
    // rostul listelor de mai sus, ținute lîngă modulele pe care le oglindesc.
    expect(MAP_STYLES.map((style) => style.key).sort()).toEqual([...LAYER_KEYS].sort());
    expect(TRAIL_FILTERS.map((filter) => filter.key).sort()).toEqual([...FILTER_KEYS].sort());
  });
});
