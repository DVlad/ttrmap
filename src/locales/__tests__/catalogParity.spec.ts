import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";
import catalogRo from "@/locales/ro";
import catalogEn from "@/locales/en";
import catalogFr from "@/locales/fr";

/**
 * Paritate deplină între cataloage: fiecare limbă oferită în selector are **exact** cheile englezei
 * (referința), nici mai puțin, nici mai mult.
 *
 * De ce e un gard, nu o formalitate: fără el, o limbă se „strică" tăcut — se adaugă un ecran nou în
 * engleză și română, iar franceza rămâne în urmă până când diferența ajunge la 555 de chei și nimeni
 * nu observă (exact ce s-a întâmplat cu fr/es/it, scoase din selector în #13). Un test de paritate
 * face imposibilă livrarea unei limbi pe jumătate traduse.
 *
 * Catalogul se citește direct din `src/locales/` (în aplicație se încarcă pe limbă, la cerere).
 */
const CATALOGS: Record<SupportedLocale, Record<string, unknown>> = {
  ro: catalogRo as Record<string, unknown>,
  en: catalogEn as Record<string, unknown>,
  fr: catalogFr as Record<string, unknown>,
};

/** Toate căile de chei dintr-un catalog, ex. `calendar.filter.running`. */
function keyPaths(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return prefix ? [prefix] : [];

  const paths: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    paths.push(...keyPaths(value, prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

describe("cataloagele de traducere", () => {
  it("testul acoperă toate limbile oferite în selector", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== "en"))(
    "%s are exact cheile englezei (fără lipsuri, fără chei moarte)",
    (locale) => {
      const reference = new Set(keyPaths(CATALOGS.en));
      const translated = keyPaths(CATALOGS[locale]);
      const translatedSet = new Set(translated);

      const missing = [...reference].filter((key) => !translatedSet.has(key));
      const extra = translated.filter((key) => !reference.has(key));

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    },
  );

  it("engleza nu are chei duplicate (referința e fără ambiguități)", () => {
    const keys = keyPaths(CATALOGS.en);
    expect(keys.length).toBe(new Set(keys).size);
  });
});
