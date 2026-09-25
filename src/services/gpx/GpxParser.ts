import { haversineMeters } from "@/services/geo/geoMath";

export interface GpxPoint {
  lat: number;
  lon: number;
  alt: number; // metri
  dist: number; // distanță cumulativă de la start (metri)
  grade: number; // gradient % (calculat)
}

export interface GpxRoute {
  id?: number; // setat după salvarea în DB
  name: string;
  points: GpxPoint[];
  totalDistanceMeters: number;
  elevationGainMeters: number;
}

// ── Haversine ──────────────────────────────────────────────────────────────
// Formula stă în `services/geo/geoMath`, ca traseele importate și alergările înregistrate să măsoare
// distanța la fel — o diferență de constantă s-ar citi ca eroare de măsurătoare, nu ca alt cod.

// ── Moving average pentru smooth pe gradient ───────────────────────────────
function movingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const half = Math.floor(window / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    const slice = values.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// ── Parser GPX ──────────────────────────────────────────────────────────────
export function parseGpx(xmlString: string): GpxRoute {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const nameEl = doc.querySelector("name");
  const name = nameEl?.textContent ?? "Rută importată";

  const trkpts = Array.from(doc.querySelectorAll("trkpt"));
  if (trkpts.length === 0) throw new Error("GPX nu conține puncte de traseu (trkpt)");

  const rawPoints = trkpts.map((pt) => ({
    lat: parseFloat(pt.getAttribute("lat") ?? "0"),
    lon: parseFloat(pt.getAttribute("lon") ?? "0"),
    alt: parseFloat(pt.querySelector("ele")?.textContent ?? "0"),
  })) as Array<{ lat: number; lon: number; alt: number }>;

  // Calculează distanțe cumulative
  const points: GpxPoint[] = [];
  let cumDist = 0;
  const rawGrades: number[] = [];

  for (let i = 0; i < rawPoints.length; i++) {
    const curr = rawPoints[i]!;
    if (i === 0) {
      rawGrades.push(0);
      points.push({ lat: curr.lat, lon: curr.lon, alt: curr.alt, dist: 0, grade: 0 });
      continue;
    }
    const prev = rawPoints[i - 1]!;
    const d = haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);
    cumDist += d;

    const deltaAlt = curr.alt - prev.alt;
    const grade = d > 0.1 ? (deltaAlt / d) * 100 : 0;
    rawGrades.push(grade);
    points.push({ lat: curr.lat, lon: curr.lon, alt: curr.alt, dist: cumDist, grade });
  }

  // Smooth gradient cu fereastră de 5 puncte
  const smoothed = movingAverage(rawGrades, 5);
  smoothed.forEach((g, i) => {
    points[i]!.grade = g;
  });

  // Câștig de elevație total
  const elevationGain = rawPoints.reduce((acc, pt, i) => {
    if (i === 0) return acc;
    const delta = pt.alt - rawPoints[i - 1]!.alt;
    return acc + (delta > 0 ? delta : 0);
  }, 0);

  return { name, points, totalDistanceMeters: cumDist, elevationGainMeters: elevationGain };
}
