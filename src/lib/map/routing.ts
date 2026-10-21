import { planRealRoute, type RouteResult } from "@/lib/services/routes";
import type { LngLat } from "@/types";

export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
}

export type { RouteResult };

/**
 * Route resolution abstraction using the real OpenRouteService and Safety Engine flow.
 */
export async function getRoutes(req: RouteRequest): Promise<RouteResult[]> {
  const res = await planRealRoute({
    origin: req.origin,
    destination: req.destination,
    profile: "foot-walking",
  });

  if (res.source === "openrouteservice" && res.routes.length > 0) {
    return res.routes;
  }

  return [];
}