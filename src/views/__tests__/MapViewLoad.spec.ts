import { describe, expect, it } from "vitest";

/**
 * Ecranul de hartă **se încarcă**.
 *
 * De ce un test atît de simplu, care nu verifică nimic „util": dacă modulul ecranului aruncă la
 * evaluare (un import stricat, o dependență care nu se rezolvă la rulare), Vue Router nu montează
 * nimic, iar ecranul apare **complet gol** — fără bară laterală, fără hartă, fără mesaj de eroare.
 * Shell-ul aplicației rămîne vizibil, deci pare că „nu se încarcă harta", cînd de fapt nu se încarcă
 * nimic. Exact asta s-a întîmplat pe 2026-09-24, și niciun test nu a prins-o.
 *
 * Un test care doar importă modulul transformă acea tăcere într-o eroare cu nume și linie.
 */
describe("ecranul de hartă", () => {
  it("modulul se evaluează fără să arunce", async () => {
    const module = await import("@/views/MapView.vue");

    expect(module.default).toBeTruthy();
  });

  it("componentele și modulele de care depinde se încarcă", async () => {
    const chart = await import("@/components/ElevationProfileChart.vue");
    const mapModules = await import("@/services/map/basemap");
    const profile = await import("@/utils/elevationProfile");

    expect(chart.default).toBeTruthy();
    expect(mapModules.MAP_STYLES.length).toBeGreaterThan(0);
    expect(typeof profile.estimateHikingMinutes).toBe("function");
  });
});
