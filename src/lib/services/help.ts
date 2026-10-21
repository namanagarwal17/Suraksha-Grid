import type { HelpPoint } from "@/types";
import { apiGet } from "@/lib/services/api";

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
}

/**
 * Fetch genuine nearby emergency help points (police, hospitals, emergency facilities).
 * Strictly requires the user's actual GPS coordinates. Never returns mock or hardcoded locations.
 */
export async function getHelpPoints(
  userLng?: number,
  userLat?: number,
  radiusM: number = 5000,
): Promise<HelpPoint[]> {
  if (userLng === undefined || userLat === undefined) {
    return [];
  }

  // 1. Try Suraksha Grid backend API (with Overpass resolution & caching)
  try {
    const rows = await apiGet<Record<string, unknown>[]>(
      `help?lat=${userLat}&lng=${userLng}&radius_m=${radiusM}`,
    );

    if (Array.isArray(rows)) {
      return rows
        .map((r) => {
          const lat = Number(r["latitude"]);
          const lng = Number(r["longitude"]);
          const dist =
            typeof r["distance_km"] === "number"
              ? +r["distance_km"].toFixed(1)
              : haversineKm(userLat, userLng, lat, lng);

          return {
            id: String(r["id"]),
            name: String(r["name"]),
            kind: (r["type"] as HelpPoint["kind"]) || "help",
            distanceKm: dist,
            open24h: Boolean(r["open_24h"]),
            openingHours:
              typeof r["opening_hours"] === "string"
                ? r["opening_hours"]
                : undefined,
            address:
              typeof r["address"] === "string" ? r["address"] : undefined,
            phone: typeof r["phone"] === "string" ? r["phone"] : undefined,
            lat,
            lng,
            x: 0,
            y: 0,
          };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }
  } catch (apiError) {
    console.warn(
      "[help] Backend nearby help query failed, falling back to direct OpenStreetMap:",
      apiError,
    );
  }

  // 2. Resilient fallback: Query OpenStreetMap Overpass directly from client
  try {
    const dLat = radiusM / 111000;
    const dLng = radiusM / (111000 * Math.cos((userLat * Math.PI) / 180));
    const minLat = (userLat - dLat).toFixed(5);
    const maxLat = (userLat + dLat).toFixed(5);
    const minLng = (userLng - dLng).toFixed(5);
    const maxLng = (userLng + dLng).toFixed(5);
    const viewbox = `${minLng},${maxLat},${maxLng},${minLat}`;

    // 1. Try fast Nominatim lookup
    try {
      const nomPromises = ["police", "hospital"].map(async (amenity) => {
        const url = `https://nominatim.openstreetmap.org/search?amenity=${amenity}&format=json&bounded=1&viewbox=${viewbox}&limit=25&addressdetails=1&extratags=1`;
        const r = await fetch(url, {
          signal: AbortSignal.timeout(4000),
          headers: { "Accept-Language": "en" },
        });
        return r.ok ? ((await r.json()) as Array<Record<string, unknown>>) : [];
      });
      const nomResults = (await Promise.all(nomPromises)).flat();
      if (nomResults.length > 0) {
        const seen = new Set<string>();
        const points: HelpPoint[] = [];
        for (const item of nomResults) {
          const lat = parseFloat(String(item.lat));
          const lng = parseFloat(String(item.lon));
          if (isNaN(lat) || isNaN(lng)) continue;
          const dist = haversineKm(userLat, userLng, lat, lng);
          if (dist * 1000 > radiusM + 150) continue;

          const amenity = String(item.type || item.class || "");
          const isPolice = amenity === "police";
          const kind: HelpPoint["kind"] = isPolice ? "police" : "hospital";
          const name =
            (item.name as string) ||
            (item.display_name as string)?.split(",")[0] ||
            (isPolice ? "Police Station" : "Hospital");

          const key = `${name.toLowerCase()}-${Math.round(lat * 1000)}-${Math.round(lng * 1000)}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const extratags = (item.extratags as Record<string, string>) || {};
          const addrObj = (item.address as Record<string, string>) || {};
          const addrParts = [
            addrObj.road,
            addrObj.suburb || addrObj.neighbourhood,
            addrObj.city || addrObj.town,
            addrObj.postcode,
          ].filter(Boolean);

          const rawHours = extratags.opening_hours;
          const open24h = isPolice || rawHours === "24/7";
          const hoursText = open24h ? "Open 24h" : rawHours || "Hours unknown";

          points.push({
            id: `osm-${item.osm_type || "node"}-${item.osm_id || Math.random()}`,
            name,
            kind,
            distanceKm: dist,
            open24h,
            openingHours: hoursText,
            address: addrParts.join(", ") || (item.display_name as string),
            phone: extratags.phone || extratags["contact:phone"] || undefined,
            lat,
            lng,
            x: 0,
            y: 0,
          });
        }
        if (points.length > 0) {
          return points.sort((a, b) => a.distanceKm - b.distanceKm);
        }
      }
    } catch {
      // Fallback to Overpass below
    }

    const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
    const query = `[out:json][timeout:6];
(
  node["amenity"="police"](${bbox});
  way["amenity"="police"](${bbox});
  node["amenity"="hospital"](${bbox});
  way["amenity"="hospital"](${bbox});
  node["amenity"="clinic"](${bbox});
  way["amenity"="clinic"](${bbox});
  node["emergency"="ambulance_station"](${bbox});
);
out center 30;`;

    const mirrors = [
      "https://overpass-api.de/api/interpreter",
      "https://lz4.overpass-api.de/api/interpreter",
      "https://z.overpass-api.de/api/interpreter",
    ];

    let elements: Array<Record<string, unknown>> = [];
    for (const mirror of mirrors) {
      try {
        const resp = await fetch(mirror, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const json = await resp.json();
          elements = json.elements || [];
          break;
        }
      } catch {
        continue;
      }
    }

    const seen = new Set<string>();
    const points: HelpPoint[] = [];

    for (const el of elements) {
      const tags = (el["tags"] as Record<string, string>) || {};
      const center = el["center"] as { lat: number; lon: number } | undefined;
      const elLat = typeof el["lat"] === "number" ? el["lat"] : center?.lat;
      const elLon = typeof el["lon"] === "number" ? el["lon"] : center?.lon;

      if (elLat === undefined || elLon === undefined) continue;

      const dist = haversineKm(userLat, userLng, elLat, elLon);
      if (dist * 1000 > radiusM + 100) continue;

      const amenity = (tags["amenity"] || "").toLowerCase();
      const kind: HelpPoint["kind"] =
        amenity === "police"
          ? "police"
          : amenity === "hospital" || amenity === "clinic"
            ? "hospital"
            : "help";

      const name =
        tags["name"] ||
        tags["name:en"] ||
        (kind === "police"
          ? "Police Station"
          : kind === "hospital"
            ? "Hospital / Medical Centre"
            : "Emergency Help Point");

      const key = `${name.toLowerCase()}-${Math.round(elLat * 1000)}-${Math.round(elLon * 1000)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const is24h =
        tags["opening_hours"] === "24/7" || tags["emergency"] === "yes";
      const hoursText = is24h ? "Open 24h" : tags["opening_hours"] || undefined;

      const addressParts = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:suburb"] || tags["addr:district"],
        tags["addr:city"],
      ].filter(Boolean);

      points.push({
        id: `osm-${el["type"]}-${el["id"]}`,
        name,
        kind,
        distanceKm: dist,
        open24h: is24h,
        openingHours: hoursText,
        address: addressParts.length ? addressParts.join(", ") : undefined,
        phone: tags["phone"] || tags["contact:phone"] || undefined,
        lat: elLat,
        lng: elLon,
        x: 0,
        y: 0,
      });
    }

    return points.sort((a, b) => a.distanceKm - b.distanceKm);
  } catch (err) {
    console.error("[help] Failed to load nearby places:", err);
    return [];
  }
}

