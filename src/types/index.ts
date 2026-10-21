export type Level = "safer" | "moderate" | "elevated" | "concern";
export type RouteId = "fastest" | "balanced" | "safest";
export type LngLat = [number, number]; // [lng, lat] — matches GeoJSON/MapLibre order

export interface RouteOption {
  id: RouteId;
  dbId?: string;
  name: string;
  etaMin: number;
  distanceKm: number;
  score: number;
  confidence: number;
  reason: string;
  segmentIds: string[];
  recommended?: boolean;
  // Phase 4 additions — optional so Phase 2 rendering still compiles
  riskFactors?: string[];
  positiveFactors?: string[];
  explanation?: string;
  timePeriod?: string;
  historicalEvidence?: {
    available: boolean;
    level: "NONE" | "LOW" | "MODERATE" | "HIGH" | "UNAVAILABLE";
    adjustment?: number;
    confidence?: number;
    explanation?: string;
    source?: string;
    source_dataset?: string;
    years?: number[];
    categories?: string[];
    intersections_count?: number;
    intersections?: Array<{
      district: string;
      state: string;
      crime_category: string;
      incident_count: number;
      year: number;
      severity_weight: number;
      intersection_m: number;
      exposure_fraction: number;
    }>;
    disclaimer?: string;
  };
}

export interface Segment {
  id: string;
  name: string;
  path: string;             // legacy SVG path — mock-map fallback only
  coords: LngLat[];         // real-world line geometry for MapLibre
  score: number;
  confidence: number;
  lighting: number;
  activity: number;
  emergency: "Good" | "Fair" | "Limited";
  timeCondition: string;
  explanation: string;
  observations: string[];
  // Phase 4 additions
  riskFactors?: string[];
  positiveFactors?: string[];
  recentReportCount?: number;
  /** Populated when historical crime dataset is available */
  historicalEvidence?: {
    level: "NONE" | "LOW" | "MODERATE" | "HIGH" | "UNAVAILABLE";
    explanation: string;
    source?: string;
    yearRange?: string;
    confidence?: number;
  };
}

export type MarkerKind = "you" | "dest" | "report" | "help";
export interface MapMarker { id: string; x: number; y: number; lng: number; lat: number; kind: MarkerKind; label: string }
export interface Story { id: string; author: string; place: string; body: string; tags: string[]; minutesAgo: number; helpful: number }
export interface SafetyReport {
  id: string;
  place: string;
  tag: string;
  minutesAgo: number;
  note: string;
  latitude?: number;
  longitude?: number;
  segmentId?: string;
}
export type HelpKind = "police" | "hospital" | "help";
export interface HelpPoint {
  id: string;
  name: string;
  kind: HelpKind;
  distanceKm: number;
  open24h: boolean;
  openingHours?: string;
  address?: string;
  phone?: string;
  x: number;
  y: number;
  lng: number;
  lat: number;
}
export interface UserProfile { name: string; email: string; initials: string; reports: number; stories: number }

// Safety engine output types (mirroring backend Python dataclasses)
export interface ScoreFactors {
  lighting: number;
  pedestrian_activity: number;
  report_penalty: number;
  severity_penalty: number;
  emergency_access: number;
  time_of_day: number;
}

export interface SafetyScoreResult {
  safety_score: number;
  confidence_score: number;
  factors: ScoreFactors;
  risk_factors: string[];
  positive_factors: string[];
  explanation: string;
  time_period: string;
  calculated_at: string;
}

export interface AnomalyResult {
  is_anomaly: boolean;
  severity: "none" | "low" | "medium" | "high";
  reason: string;
}

// Browser Geolocation types
export type GeolocationErrorCode =
  | "PERMISSION_DENIED"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT"
  | "NOT_SUPPORTED"
  | "UNKNOWN_ERROR";

export interface GeolocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

export interface GeolocationError {
  code: GeolocationErrorCode;
  message: string;
}

export type GeolocationStatus = "idle" | "loading" | "success" | "error";

export interface GeolocationState {
  coords: GeolocationCoordinates | null;
  lngLat: LngLat | null;
  status: GeolocationStatus;
  error: GeolocationError | null;
  isLoading: boolean;
  isSupported: boolean;
  timestamp: number | null;
}

export * from "./blackbox";