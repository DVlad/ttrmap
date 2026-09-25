import { describe, expect, it } from "vitest";
import {
  buildPlannedRoute,
  elevationGainLoss,
  joinSegments,
  polylineDistanceMeters,
  sampleEvenly,
  segmentsDistanceMeters,
} from "@/utils/trailStats";

/**
 * Socoteala traseului planificat, testată fără hartă și fără rețea.
 *
 * Miza nu e matematica în sine (haversine e testat prin `geoMath`), ci **contractul** planificatorului:
 * distanța se însumează pe segmentele de rută, punctul de legătură nu se dublează, iar un traseu
 * planificat are altitudinea **zero asumată**, nu o cifră inventată (vezi `docs/STUDY-MAP.md` §3.1.1).
 */

describe("polylineDistanceMeters", () => {
  it("un grad de longitudine la ecuator e ~111,2 km", () => {
    // Valoare de referință cunoscută: 1° de longitudine la ecuator ≈ 111,19 km.
    const meters = polylineDistanceMeters([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
    ]);
    expect(meters).toBeCloseTo(111_195, -2);
  });

  it("sub două puncte nu are ce măsura", () => {
    expect(polylineDistanceMeters([])).toBe(0);
    expect(polylineDistanceMeters([{ lat: 45.5, lon: 24.5 }])).toBe(0);
  });

  it("însumă toate segmentele, nu doar capetele", () => {
    const direct = polylineDistanceMeters([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 2 },
    ]);
    const throughMiddle = polylineDistanceMeters([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 2 },
    ]);
    // Aceeași distanță pe o linie dreaptă, indiferent de cîte puncte o descriu.
    expect(throughMiddle).toBeCloseTo(direct, 3);
  });

  it("un punct lipsă nu aruncă și nu contribuie", () => {
    const points = [{ lat: 0, lon: 0 }, undefined, { lat: 0, lon: 1 }] as unknown as Array<{
      lat: number;
      lon: number;
    }>;
    expect(() => polylineDistanceMeters(points)).not.toThrow();
    expect(polylineDistanceMeters(points)).toBe(0);
  });
});

describe("segmentsDistanceMeters", () => {
  it("însumează segmentele de rută", () => {
    const meters = segmentsDistanceMeters([
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
      [
        { lat: 0, lon: 1 },
        { lat: 0, lon: 2 },
      ],
    ]);
    expect(meters).toBeCloseTo(222_390, -2);
  });

  it("fără segmente e zero", () => {
    expect(segmentsDistanceMeters([])).toBe(0);
  });
});

describe("joinSegments", () => {
  it("nu scrie de două ori punctul de legătură", () => {
    const joined = joinSegments([
      [
        { lat: 45.5, lon: 24.5 },
        { lat: 45.6, lon: 24.6 },
      ],
      [
        { lat: 45.6, lon: 24.6 },
        { lat: 45.7, lon: 24.7 },
      ],
    ]);
    expect(joined).toEqual([
      { lat: 45.5, lon: 24.5 },
      { lat: 45.6, lon: 24.6 },
      { lat: 45.7, lon: 24.7 },
    ]);
  });

  it("copiază punctele, nu le împărtășește prin referință", () => {
    const source = [{ lat: 45.5, lon: 24.5 }];
    const joined = joinSegments([source]);
    joined[0]!.lat = 0;
    expect(source[0]!.lat).toBe(45.5);
  });

  it("liste goale → listă goală", () => {
    expect(joinSegments([])).toEqual([]);
    expect(joinSegments([[]])).toEqual([]);
  });
});

describe("buildPlannedRoute", () => {
  const points = [
    { lat: 45.5, lon: 24.5 },
    { lat: 45.51, lon: 24.51 },
    { lat: 45.52, lon: 24.52 },
  ];

  it("altitudinea și gradientul rămîn zero, asumat — nu se inventează o cifră", () => {
    const route = buildPlannedRoute("Test", points);
    expect(route.points.every((p) => p.alt === 0)).toBe(true);
    expect(route.points.every((p) => p.grade === 0)).toBe(true);
    expect(route.elevationGainMeters).toBe(0);
  });

  it("distanța cumulată crește și se termină la totalul traseului", () => {
    const route = buildPlannedRoute("Test", points);
    const distances = route.points.map((p) => p.dist);
    expect(distances[0]).toBe(0);
    expect(distances[1]!).toBeGreaterThan(0);
    expect(distances[2]!).toBeGreaterThan(distances[1]!);
    expect(route.totalDistanceMeters).toBeCloseTo(distances[2]!, 6);
  });

  it("păstrează coordonatele și taie spațiile din nume", () => {
    const route = buildPlannedRoute("  Turul Făgărașului  ", points);
    expect(route.name).toBe("Turul Făgărașului");
    expect(route.points.map((p) => [p.lat, p.lon])).toEqual([
      [45.5, 24.5],
      [45.51, 24.51],
      [45.52, 24.52],
    ]);
  });

  it("un traseu fără puncte nu aruncă", () => {
    const route = buildPlannedRoute("Gol", []);
    expect(route.points).toEqual([]);
    expect(route.totalDistanceMeters).toBe(0);
  });
});

describe("sampleEvenly", () => {
  const line = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 45 + i * 0.001, lon: 25 }));

  it("păstrează primul și ultimul punct", () => {
    // Capetele contează: fără ele, D+ ar rata exact începutul și sfîrșitul urcării.
    const sampled = sampleEvenly(line(1000), 10);

    expect(sampled).toHaveLength(10);
    expect(sampled[0]).toEqual({ lat: 45, lon: 25 });
    expect(sampled[9]).toEqual(line(1000)[999]);
  });

  it("nu taie nimic cînd sînt deja puține puncte", () => {
    const few = line(5);
    expect(sampleEvenly(few, 100)).toEqual(few);
  });

  it("un singur punct cerut întoarce începutul", () => {
    expect(sampleEvenly(line(10), 1)).toHaveLength(1);
  });

  it("zero puncte cerute întoarce listă goală", () => {
    expect(sampleEvenly(line(10), 0)).toEqual([]);
  });

  it("eșantionează uniform, nu pe primele N", () => {
    // Dacă ar lua primele 4, ultimul punct ar fi al patrulea din mie — și toată coborîrea ar lipsi.
    const sampled = sampleEvenly(line(1000), 4);
    expect(sampled.map((p) => p.lat)).toEqual([45, 45.333, 45.666, 45.999]);
  });
});

describe("elevationGainLoss", () => {
  it("însumă urcările și coborîrile", () => {
    const { gainM, lossM, known } = elevationGainLoss([1000, 1100, 1050, 1200]);

    expect(gainM).toBe(250);   // +100, apoi +150
    expect(lossM).toBe(50);
    expect(known).toBe(4);
  });

  it("ignoră valorile lipsă fără să le trateze ca zero", () => {
    // O citire lipsă nu are voie să apară ca o prăpastie de 1 000 m.
    const { gainM, lossM } = elevationGainLoss([1000, null, 1100]);

    expect(gainM).toBe(100);
    expect(lossM).toBe(0);
  });

  it("nu raportează nimic cînd rămîn mai puțin de două valori bune", () => {
    expect(elevationGainLoss([]).gainM).toBeNull();
    expect(elevationGainLoss([1000]).gainM).toBeNull();
    expect(elevationGainLoss([null, null]).gainM).toBeNull();
    expect(elevationGainLoss([1000, null]).gainM).toBeNull();
  });

  it("o serie plată are D+ zero, nu „necunoscut”", () => {
    const { gainM, lossM } = elevationGainLoss([1500, 1500, 1500]);
    expect(gainM).toBe(0);
    expect(lossM).toBe(0);
  });

  it("refuză valorile care nu sînt numere", () => {
    const { gainM, known } = elevationGainLoss([1000, Number.NaN, 1200]);
    expect(known).toBe(2);
    expect(gainM).toBe(200);
  });
});
