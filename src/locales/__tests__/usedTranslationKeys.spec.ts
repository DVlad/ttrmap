import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import catalogEn from "@/locales/en";

/**
 * Engleză e referința, iar cataloagele se încarcă pe limbă (`src/i18n.ts`). Deci o cheie folosită în
 * cod care lipsește din catalogul englez ajunge **vizibilă ca atare** în UI (ex. `vdot.aboutDesc`),
 * pentru orice limbă. Testul verifică exact contractul ăsta (cod ↔ catalog); paritatea dintre
 * cataloage e verificată separat, în `catalogParity.spec.ts`.
 *
 * Cheile construite dinamic (template literals) nu pot fi verificate static și sunt ignorate.
 */
const PROJECT_ROOT = resolve(__dirname, "../../..");

/** Toate căile de chei (foliate) dintr-un catalog, ex. `calendar.weekVs`. */
function keyPaths(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return prefix ? [prefix] : [];

  const paths: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    paths.push(...keyPaths(value, prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

/** Cheile de traducere referite în cod: `t("cheie")`, `$t('cheie')`, `te("cheie")`. */
function usedKeysInSource(): Map<string, string> {
  const used = new Map<string, string>();
  const keyPattern = /(?<![\w.$])\$?te?\(\s*["']([A-Za-z][\w.]*\.[\w.]+)["']/g;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "__tests__") walk(path);
        continue;
      }
      if (!/\.(vue|ts)$/.test(entry)) continue;

      const content = readFileSync(path, "utf8");
      for (const match of content.matchAll(keyPattern)) {
        const key = match[1];
        if (key && !used.has(key)) used.set(key, path.replace(`${PROJECT_ROOT}/`, ""));
      }
    }
  };

  walk(join(PROJECT_ROOT, "src"));
  return used;
}

describe("cheile de traducere folosite în cod", () => {
  it("există toate în catalogul englez (fallback-ul)", () => {
    const available = new Set(keyPaths(catalogEn));
    const missing = [...usedKeysInSource().entries()]
      .filter(([key]) => !available.has(key))
      .map(([key, file]) => `${key} (folosită în ${file})`);

    expect(missing).toEqual([]);
  });
});
