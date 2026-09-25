import { describe, expect, it } from "vitest";
import {
  buildElevationProfile,
  estimateHikingMinutes,
  HIKING_ASCENT_M_PER_HOUR,
  HIKING_FLAT_SPEED_KMH,
} from "@/utils/elevationProfile";

/**
 * Profilul altimetric și estimarea de durată.
 *
 * Miza: ce iese de aici se desenează ca un grafic pe care omul îl crede. O serie construită greșit nu
 * aruncă nicio eroare — pur și simplu arată o urcare care nu există, sau o prăpastie acolo unde de
 * fapt nu știm altitudinea.
 */

describe("buildElevationProfile", () => {
  it("leagă distanța de altitudine, în ordine", () => {
    const profile = buildElevationProfile([0, 1000, 2000], [500, 800, 1200]);

    expect(profile.points).toEqual([
      { distanceM: 0, elevationM: 500 },
      { distanceM: 1000, elevationM: 800 },
      { distanceM: 2000, elevationM: 1200 },
    ]);
    expect(profile.minElevationM).toBe(500);
    expect(profile.maxElevationM).toBe(1200);
    expect(profile.totalDistanceM).toBe(2000);
  });

  it("scoate din serie punctele fără altitudine, în loc să le pună la zero", () => {
    // Pusă la zero, o citire lipsă ar apărea ca o prăpastie pînă la nivelul mării și înapoi.
    const profile = buildElevationProfile([0, 1000, 2000, 3000], [500, null, 900, 1000]);

    expect(profile.points.map((point) => point.distanceM)).toEqual([0, 2000, 3000]);
    expect(profile.known).toBe(3);
    expect(profile.requested).toBe(4);
  });

  it("raportează cîte puncte au rămas, ca ecranul să poată avertiza", () => {
    const profile = buildElevationProfile([0, 1000, 2000], [null, 700, null]);

    expect(profile.known).toBe(1);
    expect(profile.requested).toBe(3);
    expect(profile.minElevationM).toBe(700);
  });

  it("fără nicio altitudine nu are min/max, dar nici nu aruncă", () => {
    const profile = buildElevationProfile([0, 1000], [null, null]);

    expect(profile.points).toEqual([]);
    expect(profile.minElevationM).toBeNull();
    expect(profile.maxElevationM).toBeNull();
  });

  it("se oprește la lista mai scurtă, cînd cele două nu au aceeași lungime", () => {
    const profile = buildElevationProfile([0, 1000, 2000], [500, 600]);

    expect(profile.points).toHaveLength(2);
    expect(profile.requested).toBe(2);
  });

  it("refuză valorile care nu sînt numere", () => {
    const profile = buildElevationProfile([0, 1000, 2000], [500, Number.NaN, 900]);

    expect(profile.points).toHaveLength(2);
    expect(profile.minElevationM).toBe(500);
  });
});

describe("estimateHikingMinutes", () => {
  it("adună timpul de mers cu timpul de urcuș", () => {
    // 4,2 km pe plat = 1 h; 350 m urcuș = 1 h → 2 h.
    const minutes = estimateHikingMinutes(4200, 350);

    expect(minutes).toBe(120);
    expect(minutes).toBe(Math.round(((4200 / 1000 / HIKING_FLAT_SPEED_KMH) * 60 + (350 / HIKING_ASCENT_M_PER_HOUR) * 60) / 5) * 5);
  });

  it("rotunjește la 5 minute, ca să nu pară exactă", () => {
    // O precizie de minut ar sugera o exactitate pe care modelul nu o are.
    const minutes = estimateHikingMinutes(1000, 0);
    expect(minutes).not.toBeNull();
    expect(minutes! % 5).toBe(0);
  });

  it("un traseu foarte scurt tot primește un minim", () => {
    expect(estimateHikingMinutes(50, 0)).toBe(5);
  });

  it("fără distanță nu are ce estima", () => {
    expect(estimateHikingMinutes(0, 100)).toBeNull();
    expect(estimateHikingMinutes(-10, 100)).toBeNull();
  });

  it("refuză valori imposibile în loc să scoată un număr", () => {
    expect(estimateHikingMinutes(1000, -5)).toBeNull();
    expect(estimateHikingMinutes(Number.NaN, 100)).toBeNull();
    expect(estimateHikingMinutes(1000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("crește cu urcușul, la aceeași distanță", () => {
    const flat = estimateHikingMinutes(10_000, 0)!;
    const hilly = estimateHikingMinutes(10_000, 1000)!;
    expect(hilly).toBeGreaterThan(flat);
  });
});
