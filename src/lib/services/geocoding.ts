/**
 * Suraksha Grid — Geocoding & Place Search Service.
 *
 * Provides real place-search, forward geocoding, reverse-geocoding,
 * and location/coordinate/telemetry formatters.
 */
import type { LngLat } from "@/types";

export interface SearchResult {
  id: string;
  name: string;
  fullName: string;
  coordinates: LngLat; // [longitude, latitude] matching MapLibre order
}

// In-memory cache for recent queries to avoid redundant network calls
const queryCache = new Map<string, SearchResult[]>();
const MAX_CACHE_SIZE = 50;
const geocodeReverseCache = new Map<string, string>();

/**
 * Search places and geocode to real coordinates [lng, lat].
 */
export async function searchDestinations(
  query: string,
  proximity?: LngLat | null
): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const cacheKey = `${q.toLowerCase()}_${proximity ? proximity.join(",") : "none"}`;
  if (queryCache.has(cacheKey)) {
    return queryCache.get(cacheKey)!;
  }

  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;

  if (maptilerKey) {
    try {
      let url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${maptilerKey}&limit=5`;
      if (proximity) {
        url += `&proximity=${proximity[0]},${proximity[1]}`;
      }

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`MapTiler geocoding HTTP ${res.status}`);
      }

      const data = await res.json();
      const features = (data.features ?? []) as Array<{
        id: string;
        text?: string;
        place_name?: string;
        center?: [number, number];
        geometry?: { coordinates: [number, number] };
      }>;

      const results: SearchResult[] = features
        .map((f, i) => {
          const coords = f.center ?? f.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;

          const fullName = f.place_name ?? f.text ?? "Location";
          const name = f.text ?? fullName.split(",")[0].trim();

          return {
            id: f.id ?? `maptiler-${i}-${coords[0]}-${coords[1]}`,
            name,
            fullName,
            coordinates: [coords[0], coords[1]] as LngLat,
          };
        })
        .filter((item): item is SearchResult => item !== null);

      if (results.length > 0) {
        if (queryCache.size >= MAX_CACHE_SIZE) {
          const firstKey = queryCache.keys().next().value;
          if (firstKey) queryCache.delete(firstKey);
        }
        queryCache.set(cacheKey, results);
        return results;
      }
    } catch (err) {
      console.warn("[geocoding] MapTiler geocoding failed, trying fallback:", err);
    }
  }

  // Fallback: OpenStreetMap Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Nominatim geocoding HTTP ${res.status}`);
    }

    const items = (await res.json()) as Array<{
      place_id?: number | string;
      display_name?: string;
      lat?: string;
      lon?: string;
    }>;

    const results: SearchResult[] = items
      .map((item, i) => {
        const lat = parseFloat(item.lat ?? "");
        const lon = parseFloat(item.lon ?? "");
        if (isNaN(lat) || isNaN(lon)) return null;

        const fullName = item.display_name ?? "Location";
        const name = fullName.split(",")[0].trim();

        return {
          id: String(item.place_id ?? `nominatim-${i}`),
          name,
          fullName,
          coordinates: [lon, lat] as LngLat,
        };
      })
      .filter((item): item is SearchResult => item !== null);

    if (queryCache.size >= MAX_CACHE_SIZE) {
      const firstKey = queryCache.keys().next().value;
      if (firstKey) queryCache.delete(firstKey);
    }
    queryCache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn("[geocoding] Place search failed:", err);
    return [];
  }
}

/**
 * Format latitude and longitude into clean, human-readable coordinates.
 * Example: "28.4595° N, 77.0266° E"
 */
export function formatCoordinates(lat: number | null | undefined, lng: number | null | undefined): string {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "Location unavailable";
  }
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

/**
 * Format GPS accuracy in meters.
 * Example: "±8 m" or "Low accuracy (±95 m)"
 */
export function formatAccuracy(accuracy: number | null | undefined): string {
  if (accuracy == null || !Number.isFinite(accuracy)) {
    return "Accuracy not reported";
  }
  const rounded = Math.round(accuracy);
  if (rounded > 60) {
    return `Low accuracy (±${rounded} m)`;
  }
  return `±${rounded} m`;
}

/**
 * Format duration in seconds into a friendly string.
 * Example: "42 mins" or "1 hr 15 mins"
 */
export function formatDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);

  if (hrs === 0 && mins === 0) {
    return `${secs} sec${secs === 1 ? "" : "s"}`;
  }
  if (hrs === 0) {
    return `${mins} min${mins === 1 ? "" : "s"}`;
  }
  return `${hrs} hr${hrs === 1 ? "" : "s"} ${mins} min${mins === 1 ? "" : "s"}`;
}

/**
 * Format distance in meters into friendly km or meters.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 m";
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Attempt to reverse geocode (lat, lng) to a friendly street/area name.
 * Returns null if network fails or geocoding is unavailable.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (geocodeReverseCache.has(cacheKey)) {
    return geocodeReverseCache.get(cacheKey) || null;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en",
        "User-Agent": "SurakshaGridSafetyApp/1.0",
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    const parts = [
      addr.suburb || addr.neighbourhood || addr.road || addr.quarter,
      addr.city || addr.town || addr.county || addr.state_district,
    ].filter(Boolean);

    const name = parts.length > 0 ? parts.join(", ") : data.display_name?.split(",").slice(0, 2).join(",") || null;

    if (name) {
      geocodeReverseCache.set(cacheKey, name);
    }
    return name;
  } catch {
    return null;
  }
}
