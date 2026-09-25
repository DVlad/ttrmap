import type { GpxRoute } from "@/services/gpx/GpxParser";
import { API_BASE } from "@/utils/apiBase";
import { currentUserId } from "@/utils/userScopedStorage";

// userId-ul vine din JWT pe backend; frontend-ul îl folosește doar în URL-urile GET.

// ── DTOs ───────────────────────────────────────────────────────────────────

interface RoutePointDto {
  latitude: number;
  longitude: number;
  altitudeMeters: number;
  distanceFromStartMeters: number;
  gradientPercent: number;
}

interface RouteDto {
  id: number;
  userId: number;
  name: string;
  totalDistanceMeters: number;
  elevationGainMeters: number;
  createdAt: string;
  points: RoutePointDto[];
}

// ── Mappers ────────────────────────────────────────────────────────────────

export function routeDtoToGpx(dto: RouteDto): GpxRoute {
  return {
    id: dto.id,
    name: dto.name,
    totalDistanceMeters: dto.totalDistanceMeters,
    elevationGainMeters: dto.elevationGainMeters,
    points: dto.points.map((p) => ({
      lat: p.latitude,
      lon: p.longitude,
      alt: p.altitudeMeters,
      dist: p.distanceFromStartMeters,
      grade: p.gradientPercent,
    })),
  };
}

function gpxToSaveRequest(route: GpxRoute) {
  return {
    name: route.name,
    totalDistanceMeters: route.totalDistanceMeters,
    elevationGainMeters: route.elevationGainMeters,
    points: route.points.map((p) => ({
      latitude: p.lat,
      longitude: p.lon,
      altitudeMeters: p.alt,
      distanceFromStartMeters: p.dist,
      gradientPercent: p.grade,
    })),
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

const BASE = `${API_BASE}/routes`;

export async function fetchRoutes(): Promise<GpxRoute[]> {
  const url = `${BASE}/user/${currentUserId()}`;
  console.log(`📍 Fetching routes from: ${url}`);
  try {
    const res = await fetch(url);
    console.log(`🔍 Response status: ${res.status}`);
    if (!res.ok) {
      console.error(`❌ Fetch failed: ${res.status} ${res.statusText}`);
      throw new Error(`GET routes failed: ${res.status}`);
    }
    const dtos: RouteDto[] = await res.json();
    console.log(`✅ Loaded ${dtos.length} routes`);
    return dtos.map(routeDtoToGpx);
  } catch (err) {
    console.error("❌ Routes fetch error:", err);
    throw err;
  }
}

export async function saveRoute(route: GpxRoute): Promise<GpxRoute> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(gpxToSaveRequest(route)),
  });
  if (!res.ok) throw new Error(`POST route failed: ${res.status}`);
  const dto: RouteDto = await res.json();
  return routeDtoToGpx(dto);
}

export async function renameRouteApi(id: number, name: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}/name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`PATCH route name failed: ${res.status}`);
}

export async function deleteRouteApi(id: number): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE route failed: ${res.status}`);
}
