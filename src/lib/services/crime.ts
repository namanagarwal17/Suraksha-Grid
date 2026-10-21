/**
 * Crime evidence API client.
 *
 * All calls go through the Next.js backend proxy so credentials are never
 * exposed client-side. Historical evidence is clearly labelled and never
 * presented as a probability.
 */
import { apiGet, apiPost } from "@/lib/services/api";
import type { Segment } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrimeEvidenceStatus {
  dataset_available: boolean;
  message: string;
  disclaimer: string;
}

export interface IntersectionRecord {
  district: string;
  state: string;
  crime_category: string;
  incident_count: number;
  year: number;
  severity_weight: number;
  intersection_m: number;
  exposure_fraction: number;
  source: string;
  source_dataset: string;
}

export interface CrimeDistrictProperties {
  district: string;
  state: string;
  year: number;
  source: string;
  source_dataset: string;
  total_incidents: number;
  women_cases: number;
  children_cases: number;
  ipc_cases: number;
  sll_cases: number;
  severity_weight: number;
  evidence_level: "HIGH" | "MODERATE" | "LOW";
}

export interface CrimeGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: CrimeDistrictProperties;
    geometry: { type: string; coordinates: unknown };
  }>;
}

export interface RouteEvidenceResult {
  dataset_available: boolean;
  evidence_level: "NONE" | "LOW" | "MODERATE" | "HIGH" | "UNAVAILABLE";
  confidence: number;
  score_adjustment: number;
  intersections: IntersectionRecord[];
  years: number[];
  categories: string[];
  source: string;
  source_dataset: string;
  explanation: string;
  disclaimer: string;
  limitations: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Fetch processed NCRB district boundary polygons with crime counts.
 */
export async function fetchCrimeGeoJSON(): Promise<CrimeGeoJSON> {
  try {
    return await apiGet<CrimeGeoJSON>("crime/geojson");
  } catch (err) {
    console.warn("[CrimeService] Failed to load crime GeoJSON:", err);
    return { type: "FeatureCollection", features: [] };
  }
}

/**
 * Check whether the historical crime dataset has been imported.
 */
export async function checkEvidenceStatus(): Promise<CrimeEvidenceStatus> {
  return apiGet<CrimeEvidenceStatus>("crime/evidence");
}

/**
 * Fetch historical crime evidence for a road segment by its UUID.
 * Returns UNAVAILABLE evidence when the dataset is absent or the segment
 * has no attached geometry — the UI degrades gracefully in both cases.
 */
export async function fetchSegmentEvidence(
  segmentId: string,
): Promise<RouteEvidenceResult | null> {
  try {
    return await apiGet<RouteEvidenceResult>(`crime/segment/${segmentId}`);
  } catch {
    return null;
  }
}

/**
 * Convert a RouteEvidenceResult into the historicalEvidence shape the
 * Segment / SafetyLens component expects.
 */
export function evidenceToSegmentField(
  ev: RouteEvidenceResult | null,
): Segment["historicalEvidence"] | undefined {
  if (!ev) return undefined;

  const yearRange =
    ev.years.length > 0
      ? ev.years.length === 1
        ? String(ev.years[0])
        : `${Math.min(...ev.years)}–${Math.max(...ev.years)}`
      : undefined;

  return {
    level:       ev.evidence_level,
    explanation: ev.explanation,
    source:      ev.source || (ev.dataset_available ? "NCRB" : undefined),
    yearRange,
    confidence:  ev.confidence,
  };
}
