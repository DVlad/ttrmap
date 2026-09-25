import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRoute,
  MAX_ROUTE_WAYPOINTS,
  routeGeometry,
  TRAVEL_PROFILES,
  type RoutePlan,
} from "@/services/api/routingApi";

/**
 * Cererea de rutare către backend.
 *
 * Ce se apără aici: contractul de date cu backend-ul (numele cîmpurilor, ordinea `[lon, lat]`) și
 * faptul că un eșec **aruncă** în loc să întoarcă o rută inventată. Pînă în F3, eșecul se transforma
 * tăcut într-o linie dreaptă care ajungea pe hartă ca traseu calculat.
 */

const POINTS = [
  { lat: 45.4457, lon: 25.4566 },
  { lat: 45.4028, lon: 25.4645 },
];

function plan(overrides: Partial<RoutePlan> = {}): RoutePlan {
  return {
    distanceMeters: 6347,
    durationSeconds: 4792.4,
    profile: "foot",
    geometry: [
      [25.4566, 45.4457],
      [25.4645, 45.4028],
    ],
    legs: [
      {
        distanceMeters: 6347,
        durationSeconds: 4792.4,
        geometry: [
          [25.4566, 45.4457],
          [25.4645, 45.4028],
        ],
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Un `fetch` simulat care **păstrează tipul** argumentelor. Fără el, `vi.fn(async () => …)` are
 * semnătura `() => …`, deci testul nu poate citi corpul cererii — iar contractul care contează aici e
 * exact ce pleacă.
 */
function stubFetch(respond: (url: string, init?: RequestInit) => Response) {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async (url, init) => respond(String(url), init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function okFetch() {
  return stubFetch(() => new Response(JSON.stringify(plan()), { status: 200 }));
}

function bodyOf(mock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const init = mock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("fetchRoute", () => {
  it("trimite punctele ca latitudine/longitudine și profilul ales", async () => {
    const fetchMock = okFetch();

    await fetchRoute(POINTS, "mtb");

    const url = fetchMock.mock.calls[0]?.[0];
    expect(String(url)).toContain("/routing/route");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");

    const body = bodyOf(fetchMock) as {
      points: { latitude: number; longitude: number }[];
      profile: string;
    };
    expect(body.profile).toBe("mtb");
    expect(body.points).toEqual([
      { latitude: 45.4457, longitude: 25.4566 },
      { latitude: 45.4028, longitude: 25.4645 },
    ]);
  });

  it("merge implicit pe jos", async () => {
    const fetchMock = okFetch();

    await fetchRoute(POINTS);

    expect(bodyOf(fetchMock)).toMatchObject({ profile: "foot" });
  });

  it("întoarce planul primit, cu etapele lui", async () => {
    okFetch();

    const result = await fetchRoute(POINTS);

    expect(result.distanceMeters).toBe(6347);
    expect(result.legs).toHaveLength(1);
  });

  it("aruncă, cu mesajul backend-ului, cînd motorul nu e disponibil", async () => {
    stubFetch(() => new Response("Rutarea nu e disponibilă acum.", { status: 503 }));

    await expect(fetchRoute(POINTS)).rejects.toThrow("Rutarea nu e disponibilă acum.");
  });

  it("aruncă și cînd răspunsul de eroare n-are corp", async () => {
    stubFetch(() => new Response("", { status: 500 }));

    await expect(fetchRoute(POINTS)).rejects.toThrow(/500/);
  });

  it("refuză local mai puțin de două puncte, fără să cheme serverul", async () => {
    const fetchMock = stubFetch(() => new Response("", { status: 500 }));

    await expect(fetchRoute([POINTS[0]!])).rejects.toThrow(/două puncte/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nu trimite mai multe puncte decît acceptă backend-ul", async () => {
    const fetchMock = okFetch();

    const many = Array.from({ length: MAX_ROUTE_WAYPOINTS + 10 }, (_, i) => ({
      lat: 45 + i * 0.01,
      lon: 25,
    }));
    await fetchRoute(many);

    const body = bodyOf(fetchMock) as { points: unknown[] };
    expect(body.points).toHaveLength(MAX_ROUTE_WAYPOINTS);
  });
});

describe("routeGeometry", () => {
  it("întoarce punctele în ordinea lat/lon a aplicației", () => {
    expect(routeGeometry(plan())).toEqual([
      { lat: 45.4457, lon: 25.4566 },
      { lat: 45.4028, lon: 25.4645 },
    ]);
  });
});

describe("TRAVEL_PROFILES", () => {
  it("acoperă exact profilurile pe care le știe backend-ul", () => {
    // Aceleași nume ca `RoutePlanPolicy.TryParseProfile`; unul scris greșit ar fi refuzat cu 400.
    expect(TRAVEL_PROFILES.map((profile) => profile.key)).toEqual(["foot", "bike", "mtb"]);
  });

  it("are etichetă pentru fiecare profil", () => {
    for (const profile of TRAVEL_PROFILES) {
      expect(profile.labelKey).toMatch(/^map\.travelProfile\./);
    }
  });
});
