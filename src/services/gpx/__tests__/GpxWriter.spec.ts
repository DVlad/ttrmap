import { describe, expect, it } from "vitest";
import { parseGpx, type GpxRoute } from "@/services/gpx/GpxParser";
import { gpxFileName, serializeGpx } from "@/services/gpx/GpxWriter";
import { buildPlannedRoute } from "@/utils/trailStats";

/**
 * Scriitorul de GPX, verificat prin **turul complet**: serializează → parsează cu parserul
 * aplicației → aceleași puncte. Un test care doar compară șiruri ar confirma că am scris ce am
 * scris; turul complet confirmă că fișierul chiar poate fi recitit (de noi sau de un ceas).
 */

/**
 * Traseu de test. Distanțele din structură rămîn zero **deliberat**: `GpxWriter` scrie doar
 * coordonate, iar cine citește fișierul le recalculează — deci un `totalDistanceMeters` plin aici
 * n-ar ajunge niciodată în fișier și ar da un test care validează o iluzie.
 */
function route(points: Array<{ lat: number; lon: number; alt?: number }>, name = "Traseu"): GpxRoute {
  return {
    name,
    points: points.map((p) => ({ lat: p.lat, lon: p.lon, alt: p.alt ?? 0, dist: 0, grade: 0 })),
    totalDistanceMeters: 0,
    elevationGainMeters: 0,
  };
}

describe("serializeGpx", () => {
  it("tur complet: ce se scrie se poate reciti", () => {
    const original = route([
      { lat: 45.5, lon: 24.5 },
      { lat: 45.51, lon: 24.51 },
      { lat: 45.52, lon: 24.52 },
    ]);

    const parsed = parseGpx(serializeGpx(original));

    expect(parsed.name).toBe("Traseu");
    expect(parsed.points.map((p) => [p.lat, p.lon])).toEqual([
      [45.5, 24.5],
      [45.51, 24.51],
      [45.52, 24.52],
    ]);
  });

  it("distanța de la recitire e distanța reală dintre coordonate", () => {
    // Fișierul GPX nu duce distanțe, doar coordonate. Deci turul complet trebuie să dea exact
    // distanța pe care o construiește planificatorul din aceleași puncte — o legătură între două
    // module care altfel ar putea măsura diferit.
    const planned = buildPlannedRoute("Traseu", [
      { lat: 45.5, lon: 24.5 },
      { lat: 45.51, lon: 24.51 },
    ]);
    const parsed = parseGpx(serializeGpx(planned));
    expect(parsed.totalDistanceMeters).toBeCloseTo(planned.totalDistanceMeters, 6);
  });

  it("scrie altitudinea explicit, inclusiv cînd e zero", () => {
    // Omiterea lui `<ele>` ar face altitudinea „necunoscută"; `0` e o valoare cunoscută și asumată
    // (traseu planificat fără DEM), iar cine importă fișierul trebuie să vadă exact asta.
    const xml = serializeGpx(route([{ lat: 45.5, lon: 24.5, alt: 0 }]));
    expect(xml).toContain("<ele>0</ele>");
  });

  it("escapează numele: `&` și `<` nu sparg XML-ul", () => {
    const parsed = parseGpx(serializeGpx(route([{ lat: 45.5, lon: 24.5 }], "Tur & sus <sus>")));
    expect(parsed.name).toBe("Tur & sus <sus>");
  });

  it("declară GPX 1.1 cu numele de spațiu corect", () => {
    const xml = serializeGpx(route([{ lat: 45.5, lon: 24.5 }]));
    expect(xml).toContain('version="1.1"');
    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
  });
});

describe("gpxFileName", () => {
  it("adaugă extensia și înlocuiește spațiile", () => {
    expect(gpxFileName("Turul Făgărașului")).toBe("Turul_Făgărașului.gpx");
  });

  it("scoate caracterele care nu au ce căuta într-un nume de fișier", () => {
    expect(gpxFileName('Traseu: "test"/1')).toBe("Traseu_test1.gpx");
  });

  it("un nume care rămîne gol primește unul implicit", () => {
    expect(gpxFileName("///")).toBe("traseu.gpx");
  });
});
