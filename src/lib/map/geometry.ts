import type { LngLat } from "@/types";

type GeoJSONLineString = {
  type?: unknown;
  coordinates?: unknown;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Convert a PostGIS/Supabase GeoJSON value into MapLibre [lng, lat] pairs.
 * The helper accepts either an already-parsed object or a JSON string and
 * rejects malformed/non-LineString geometry instead of guessing.
 */
export function lineStringCoords(value: unknown): LngLat[] {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const geometry = parsed as GeoJSONLineString;
  if (geometry.type !== undefined && geometry.type !== "LineString") return [];

  if (!Array.isArray(geometry.coordinates)) return [];

  return geometry.coordinates.flatMap((point): LngLat[] => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
    return [[lng, lat]];
  });
}

/**
 * Great-circle distance between two [lng, lat] coordinates in meters.
 */
export function haversineDistanceMeters(a: LngLat, b: LngLat): number {
  const R = 6371e3; // Earth radius in meters
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Shortest distance in meters from point P to line segment A -> B.
 */
export function distanceToSegmentMeters(p: LngLat, a: LngLat, b: LngLat): number {
  const midLatRad = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const mPerDegLat = 111139;
  const mPerDegLng = 111139 * Math.cos(midLatRad);

  const vx = (b[0] - a[0]) * mPerDegLng;
  const vy = (b[1] - a[1]) * mPerDegLat;
  const wx = (p[0] - a[0]) * mPerDegLng;
  const wy = (p[1] - a[1]) * mPerDegLat;

  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) {
    return Math.sqrt(wx * wx + wy * wy);
  }

  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  const projX = vx * t;
  const projY = vy * t;
  const dx = wx - projX;
  const dy = wy - projY;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Minimum distance in meters from point P to any segment of a polyline.
 */
export function minDistanceToPolylineMeters(p: LngLat, polyline: LngLat[]): number {
  if (!polyline || polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineDistanceMeters(p, polyline[0]);

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distanceToSegmentMeters(p, polyline[i], polyline[i + 1]);
    if (d < minDist) {
      minDist = d;
    }
  }
  return minDist;
}

/**
 * Detects whether coordinates form a synthetic straight-line bounding-box outline
 * or axis-aligned grid rectangle rather than genuine road-following geometry.
 */
export function isSyntheticBoundingGeometry(coords: LngLat[]): boolean {
  if (!coords || coords.length < 2) return true;

  // Exactly 2 points that are purely horizontal or vertical (axis-aligned grid lines)
  if (coords.length === 2) {
    const [p1, p2] = coords;
    const isHorizontal = Math.abs(p1[1] - p2[1]) < 0.00001;
    const isVertical = Math.abs(p1[0] - p2[0]) < 0.00001;
    if (isHorizontal || isVertical) return true;
  }

  // Exactly 3 points forming a 90-degree axis-aligned bounding box corner
  if (coords.length === 3) {
    const [p1, p2, p3] = coords;
    const seg1Vertical = Math.abs(p1[0] - p2[0]) < 0.00001;
    const seg1Horizontal = Math.abs(p1[1] - p2[1]) < 0.00001;
    const seg2Vertical = Math.abs(p2[0] - p3[0]) < 0.00001;
    const seg2Horizontal = Math.abs(p2[1] - p3[1]) < 0.00001;
    if ((seg1Vertical && seg2Horizontal) || (seg1Horizontal && seg2Vertical)) {
      return true;
    }
  }

  return false;
}
