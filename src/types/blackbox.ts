/**
 * Suraksha Grid — Safety Black Box Types
 *
 * Defines types for user-controlled local journey recording,
 * timeline events, telemetry points, and report generation.
 */

export type JourneyStatus =
  | "idle"
  | "recording"
  | "paused"
  | "stopped_detected"
  | "completed";

export type JourneyEventType =
  | "journey_started"
  | "stop_detected"
  | "journey_resumed"
  | "manual_pause"
  | "manual_resume"
  | "low_accuracy_warning"
  | "gps_interrupted"
  | "gps_recovered"
  | "journey_completed";

export interface JourneyPoint {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null; // meters
  altitude: number | null; // meters
  heading: number | null; // degrees
  speed: number | null; // m/s
  timestamp: number; // Unix epoch ms
  source: "gps" | "simulated";
}

export interface JourneyEvent {
  id: string;
  type: JourneyEventType;
  name: string;
  timestamp: number; // Unix epoch ms
  locationName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  details?: string | null;
}

export interface JourneyRecord {
  id: string; // e.g. "sbb_jny_1729254890_abc123"
  title: string;
  startLocationName: string | null;
  destinationName: string | null;
  status: JourneyStatus;
  startTime: number;
  endTime: number | null;
  durationSeconds: number;
  totalDistanceMeters: number;
  pointsCount: number;
  events: JourneyEvent[];
  points: JourneyPoint[];
  hasInaccuratePoints: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ActiveRecordingState {
  isActive: boolean;
  journeyId: string | null;
  status: JourneyStatus;
  startedAt: number | null;
  elapsedSeconds: number;
  pointsCount: number;
  lastPoint: JourneyPoint | null;
  isStationary: boolean;
  stationarySince: number | null;
  error: string | null;
}
