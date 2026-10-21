/**
 * Suraksha Grid — Safety Black Box Journey Recording Engine
 *
 * Provides privacy-first, user-controlled local journey tracking,
 * automatic stop/resume detection, manual pause/resume, GPS accuracy filtering,
 * and crash-recovery state persistence.
 */

import { haversineDistanceMeters } from "@/lib/map/geometry";
import { formatCoordinates, reverseGeocode } from "./geocoding";
import {
  saveJourney,
  getJourney,
  getActiveJourneyId,
  setActiveJourneyId,
} from "./blackbox-storage";
import type {
  JourneyPoint,
  JourneyEvent,
  JourneyRecord,
  JourneyStatus,
  ActiveRecordingState,
} from "@/types/blackbox";

// Thresholds for intelligent, battery-efficient recording
const MIN_DISTANCE_BETWEEN_POINTS_METERS = 7; // Record point if moved >= 7m
const MAX_TIME_BETWEEN_POINTS_MS = 15_000; // Or at least every 15s if moved
const STOP_DETECTION_TIME_MS = 75_000; // 75 seconds of stationary -> stop detected
const STOP_DISTANCE_RADIUS_METERS = 18; // Radius to consider stationary
const RESUME_DISTANCE_METERS = 28; // Distance moved to trigger journey resume
const LOW_ACCURACY_THRESHOLD_METERS = 70; // Warn if accuracy worse than 70m

type StateListener = (state: ActiveRecordingState) => void;

export class BlackBoxRecorder {
  private activeJourney: JourneyRecord | null = null;
  private watchId: number | null = null;
  private listeners = new Set<StateListener>();
  private stationaryCheckTimer: ReturnType<typeof setInterval> | null = null;
  private stationaryAnchorPoint: JourneyPoint | null = null;
  private isDetectedStopped = false;
  private lastRecordedTime = 0;
  private lastPoint: JourneyPoint | null = null;
  private lowAccuracyWarned = false;
  private isGpsInterrupted = false;

  constructor() {
    // Attempt auto-restore on instantiation in browser
    if (typeof window !== "undefined") {
      void this.tryRestoreActiveJourney();
    }
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  public isActivelyRecording(): boolean {
    return this.activeJourney !== null && this.activeJourney.status === "recording";
  }

  public getActiveJourney(): JourneyRecord | null {
    return this.activeJourney;
  }

  public getState(): ActiveRecordingState {
    const j = this.activeJourney;
    const now = Date.now();
    const elapsed = j?.startTime
      ? Math.floor((now - j.startTime) / 1000)
      : 0;

    return {
      isActive: j !== null && j.status !== "completed",
      journeyId: j?.id ?? null,
      status: j?.status ?? "idle",
      startedAt: j?.startTime ?? null,
      elapsedSeconds: j?.durationSeconds || elapsed,
      pointsCount: j?.points.length ?? 0,
      lastPoint: this.lastPoint,
      isStationary: this.isDetectedStopped,
      stationarySince: this.stationaryAnchorPoint?.timestamp ?? null,
      error: null,
    };
  }

  /**
   * Attempt to recover an incomplete journey if app refreshed or was interrupted.
   */
  public async tryRestoreActiveJourney(): Promise<JourneyRecord | null> {
    if (this.activeJourney) return this.activeJourney;

    try {
      const activeId = await getActiveJourneyId();
      if (!activeId) return null;

      const saved = await getJourney(activeId);
      if (saved && saved.status !== "completed") {
        this.activeJourney = saved;
        this.lastPoint = saved.points[saved.points.length - 1] || null;
        this.notify();
        return saved;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Start a new journey recording with explicit user consent.
   */
  public async startJourney(params: {
    startLocationName?: string;
    destinationName?: string;
    initialCoords?: { latitude: number; longitude: number; accuracy?: number | null };
  } = {}): Promise<JourneyRecord> {
    if (typeof window === "undefined" || !navigator.geolocation) {
      throw new Error("Geolocation is not supported in this environment");
    }

    const now = Date.now();
    const uniqueId = `sbb_jny_${now}_${Math.random().toString(36).substring(2, 8)}`;

    const initialEvents: JourneyEvent[] = [];
    const initialPoints: JourneyPoint[] = [];

    let startName = params.startLocationName || null;
    if (params.initialCoords) {
      const p: JourneyPoint = {
        id: `pt_${now}_0`,
        latitude: params.initialCoords.latitude,
        longitude: params.initialCoords.longitude,
        accuracy: params.initialCoords.accuracy ?? null,
        altitude: null,
        heading: null,
        speed: 0,
        timestamp: now,
        source: "gps",
      };
      initialPoints.push(p);
      this.lastPoint = p;
      this.stationaryAnchorPoint = p;

      if (!startName) {
        startName = formatCoordinates(p.latitude, p.longitude);
      }
    }

    initialEvents.push({
      id: `evt_start_${now}`,
      type: "journey_started",
      name: "Journey started",
      timestamp: now,
      locationName: startName,
      latitude: params.initialCoords?.latitude ?? null,
      longitude: params.initialCoords?.longitude ?? null,
      accuracy: params.initialCoords?.accuracy ?? null,
      details: "User initiated Safety Black Box journey recording",
    });

    const newJourney: JourneyRecord = {
      id: uniqueId,
      title: params.destinationName
        ? `Journey to ${params.destinationName}`
        : `Journey ${new Date(now).toLocaleDateString()}`,
      startLocationName: startName,
      destinationName: params.destinationName || null,
      status: "recording",
      startTime: now,
      endTime: null,
      durationSeconds: 0,
      totalDistanceMeters: 0,
      pointsCount: initialPoints.length,
      events: initialEvents,
      points: initialPoints,
      hasInaccuratePoints: false,
      createdAt: now,
      updatedAt: now,
    };

    this.activeJourney = newJourney;
    this.isDetectedStopped = false;
    this.lowAccuracyWarned = false;
    this.isGpsInterrupted = false;
    this.lastRecordedTime = now;

    await saveJourney(newJourney);
    await setActiveJourneyId(uniqueId);

    // Asynchronously resolve friendly street name if coordinates provided
    if (params.initialCoords && !params.startLocationName) {
      void reverseGeocode(params.initialCoords.latitude, params.initialCoords.longitude).then((name) => {
        if (name && this.activeJourney && this.activeJourney.id === uniqueId) {
          this.activeJourney.startLocationName = name;
          if (this.activeJourney.events[0]) {
            this.activeJourney.events[0].locationName = name;
          }
          void saveJourney(this.activeJourney);
          this.notify();
        }
      });
    }

    this.startGpsWatch();
    this.startStationaryMonitor();
    this.notify();

    return newJourney;
  }

  /**
   * Start native GPS position watcher.
   */
  private startGpsWatch(): void {
    if (this.watchId !== null) return;
    if (typeof window === "undefined" || !navigator.geolocation) return;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handleGpsUpdate(pos),
      (err) => this.handleGpsError(err),
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 5_000,
      }
    );
  }

  private stopGpsWatch(): void {
    if (this.watchId !== null && typeof window !== "undefined") {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private startStationaryMonitor(): void {
    if (this.stationaryCheckTimer) clearInterval(this.stationaryCheckTimer);

    // Periodic check for stop detection
    this.stationaryCheckTimer = setInterval(() => {
      this.evaluateStopAndResume();
    }, 10_000);
  }

  private stopStationaryMonitor(): void {
    if (this.stationaryCheckTimer) {
      clearInterval(this.stationaryCheckTimer);
      this.stationaryCheckTimer = null;
    }
  }

  /**
   * Handle incoming GPS coordinate update.
   */
  private handleGpsUpdate(pos: GeolocationPosition): void {
    if (!this.activeJourney || this.activeJourney.status !== "recording") return;

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy ?? null;
    const speed = pos.coords.speed ?? null;
    const heading = pos.coords.heading ?? null;
    const altitude = pos.coords.altitude ?? null;
    const timestamp = pos.timestamp || Date.now();

    // Validate coordinates
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return;
    }

    // Recover from GPS interruption if was active
    if (this.isGpsInterrupted) {
      this.isGpsInterrupted = false;
      this.recordEvent({
        type: "gps_recovered",
        name: "GPS signal restored",
        timestamp,
        latitude: lat,
        longitude: lng,
        accuracy,
        details: "Live satellite telemetry resumed",
      });
    }

    // Accuracy warning check
    if (accuracy && accuracy > LOW_ACCURACY_THRESHOLD_METERS) {
      this.activeJourney.hasInaccuratePoints = true;
      if (!this.lowAccuracyWarned) {
        this.lowAccuracyWarned = true;
        this.recordEvent({
          type: "low_accuracy_warning",
          name: "GPS accuracy is low",
          timestamp,
          latitude: lat,
          longitude: lng,
          accuracy,
          details: `Accuracy reduced (±${Math.round(accuracy)}m). Points may fluctuate.`,
        });
      }
    } else {
      this.lowAccuracyWarned = false;
    }

    // Battery-efficient filtering:
    // Determine whether to append point based on distance moved or elapsed interval
    let shouldRecord = false;
    let distFromLast = 0;

    if (!this.lastPoint) {
      shouldRecord = true;
    } else {
      distFromLast = haversineDistanceMeters(
        [this.lastPoint.longitude, this.lastPoint.latitude],
        [lng, lat]
      );
      const timeSinceLast = timestamp - this.lastRecordedTime;

      if (distFromLast >= MIN_DISTANCE_BETWEEN_POINTS_METERS) {
        shouldRecord = true;
      } else if (timeSinceLast >= MAX_TIME_BETWEEN_POINTS_MS) {
        shouldRecord = true;
      }
    }

    if (shouldRecord) {
      const newPt: JourneyPoint = {
        id: `pt_${timestamp}_${this.activeJourney.points.length}`,
        latitude: lat,
        longitude: lng,
        accuracy,
        altitude,
        heading,
        speed,
        timestamp,
        source: "gps",
      };

      this.activeJourney.points.push(newPt);
      if (this.lastPoint) {
        this.activeJourney.totalDistanceMeters += distFromLast;
      }
      if (!this.isDetectedStopped && (distFromLast >= STOP_DISTANCE_RADIUS_METERS || !this.stationaryAnchorPoint)) {
        this.stationaryAnchorPoint = newPt;
      }
      this.lastPoint = newPt;
      this.lastRecordedTime = timestamp;

      // Update duration
      this.activeJourney.durationSeconds = Math.max(
        0,
        Math.floor((timestamp - this.activeJourney.startTime) / 1000)
      );

      // Periodically persist to IndexedDB
      void saveJourney(this.activeJourney);
      this.notify();
    }
  }

  /**
   * Handle GPS errors (permission denied, timeout, unavailable).
   */
  private handleGpsError(err: GeolocationPositionError): void {
    if (!this.activeJourney || this.activeJourney.status !== "recording") return;

    if (!this.isGpsInterrupted) {
      this.isGpsInterrupted = true;
      const msg = err.code === 1 ? "Permission denied" : err.code === 2 ? "Position unavailable" : "Signal timeout";
      this.recordEvent({
        type: "gps_interrupted",
        name: "GPS telemetry interrupted",
        timestamp: Date.now(),
        latitude: this.lastPoint?.latitude ?? null,
        longitude: this.lastPoint?.longitude ?? null,
        details: `Telemetry temporarily interrupted: ${msg}`,
      });
    }
  }

  /**
   * Evaluate whether user has stopped or resumed movement.
   */
  private evaluateStopAndResume(): void {
    if (!this.activeJourney || this.activeJourney.status !== "recording" || !this.lastPoint) {
      return;
    }

    const now = Date.now();
    if (!this.stationaryAnchorPoint) {
      this.stationaryAnchorPoint = this.lastPoint;
      return;
    }

    const distFromAnchor = haversineDistanceMeters(
      [this.stationaryAnchorPoint.longitude, this.stationaryAnchorPoint.latitude],
      [this.lastPoint.longitude, this.lastPoint.latitude]
    );

    const timeStationary = now - this.stationaryAnchorPoint.timestamp;

    // Check for STOP
    if (!this.isDetectedStopped) {
      if (distFromAnchor <= STOP_DISTANCE_RADIUS_METERS && timeStationary >= STOP_DETECTION_TIME_MS) {
        this.isDetectedStopped = true;
        const stopLat = this.lastPoint.latitude;
        const stopLng = this.lastPoint.longitude;

        this.recordEvent({
          type: "stop_detected",
          name: "Stop detected",
          timestamp: now,
          latitude: stopLat,
          longitude: stopLng,
          accuracy: this.lastPoint.accuracy,
          details: `Stationary for ${Math.round(timeStationary / 1000)}s`,
        });

        // Resolve friendly address for the stop location
        void reverseGeocode(stopLat, stopLng).then((addr) => {
          if (addr && this.activeJourney) {
            const ev = this.activeJourney.events.find(
              (e) => e.type === "stop_detected" && e.timestamp === now
            );
            if (ev) {
              ev.locationName = addr;
              void saveJourney(this.activeJourney);
              this.notify();
            }
          }
        });
      }
    } else {
      // Check for RESUME
      if (distFromAnchor >= RESUME_DISTANCE_METERS) {
        this.isDetectedStopped = false;
        this.stationaryAnchorPoint = this.lastPoint;

        this.recordEvent({
          type: "journey_resumed",
          name: "Movement resumed",
          timestamp: now,
          latitude: this.lastPoint.latitude,
          longitude: this.lastPoint.longitude,
          accuracy: this.lastPoint.accuracy,
          details: `Resumed travel (${Math.round(distFromAnchor)}m from stop)`,
        });
      }
    }
  }

  /**
   * Manual pause: distinctly records a manual pause event and halts point ingestion.
   */
  public async pauseJourney(): Promise<void> {
    if (!this.activeJourney || this.activeJourney.status !== "recording") return;

    const now = Date.now();
    this.activeJourney.status = "paused";
    this.stopGpsWatch();

    this.recordEvent({
      type: "manual_pause",
      name: "Recording paused manually",
      timestamp: now,
      latitude: this.lastPoint?.latitude ?? null,
      longitude: this.lastPoint?.longitude ?? null,
      details: "User paused Safety Black Box recording",
    });

    await saveJourney(this.activeJourney);
    this.notify();
  }

  /**
   * Manual resume: distinctly records manual resume event and restarts GPS watcher.
   */
  public async resumeJourney(): Promise<void> {
    if (!this.activeJourney || this.activeJourney.status !== "paused") return;

    const now = Date.now();
    this.activeJourney.status = "recording";
    this.stationaryAnchorPoint = this.lastPoint;
    this.isDetectedStopped = false;

    this.recordEvent({
      type: "manual_resume",
      name: "Recording resumed manually",
      timestamp: now,
      latitude: this.lastPoint?.latitude ?? null,
      longitude: this.lastPoint?.longitude ?? null,
      details: "User resumed Safety Black Box recording",
    });

    this.startGpsWatch();
    await saveJourney(this.activeJourney);
    this.notify();
  }

  /**
   * Complete the journey: record completion timestamp, stop tracking, finalize data.
   */
  public async completeJourney(destinationName?: string): Promise<JourneyRecord> {
    if (!this.activeJourney) {
      throw new Error("No active journey to complete");
    }

    const now = Date.now();
    this.stopGpsWatch();
    this.stopStationaryMonitor();

    let destName = destinationName || this.activeJourney.destinationName;
    if (!destName && this.lastPoint) {
      destName = formatCoordinates(this.lastPoint.latitude, this.lastPoint.longitude);
    }

    this.activeJourney.status = "completed";
    this.activeJourney.endTime = now;
    this.activeJourney.durationSeconds = Math.max(
      1,
      Math.floor((now - this.activeJourney.startTime) / 1000)
    );
    this.activeJourney.destinationName = destName || null;

    this.recordEvent({
      type: "journey_completed",
      name: "Journey completed",
      timestamp: now,
      locationName: destName,
      latitude: this.lastPoint?.latitude ?? null,
      longitude: this.lastPoint?.longitude ?? null,
      accuracy: this.lastPoint?.accuracy ?? null,
      details: `Completed in ${Math.round(this.activeJourney.durationSeconds / 60)} mins`,
    });

    const finalized = { ...this.activeJourney };
    await saveJourney(finalized);
    await setActiveJourneyId(null);

    // Asynchronously resolve destination reverse geocoding if needed
    if (this.lastPoint && !destinationName) {
      void reverseGeocode(this.lastPoint.latitude, this.lastPoint.longitude).then((name) => {
        if (name) {
          finalized.destinationName = name;
          const endEv = finalized.events.find((e) => e.type === "journey_completed");
          if (endEv) endEv.locationName = name;
          void saveJourney(finalized);
        }
      });
    }

    this.activeJourney = null;
    this.lastPoint = null;
    this.stationaryAnchorPoint = null;
    this.isDetectedStopped = false;
    this.notify();

    return finalized;
  }

  /**
   * Discard/cancel active journey if user explicitly requests it.
   */
  public async cancelJourney(): Promise<void> {
    this.stopGpsWatch();
    this.stopStationaryMonitor();
    if (this.activeJourney) {
      const id = this.activeJourney.id;
      this.activeJourney = null;
      await setActiveJourneyId(null);
      // Clean up incomplete journey record
      const { deleteJourney } = await import("./blackbox-storage");
      await deleteJourney(id);
    }
    this.lastPoint = null;
    this.stationaryAnchorPoint = null;
    this.isDetectedStopped = false;
    this.notify();
  }

  private recordEvent(eventData: Omit<JourneyEvent, "id">): void {
    if (!this.activeJourney) return;

    const event: JourneyEvent = {
      ...eventData,
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };

    this.activeJourney.events.push(event);
    void saveJourney(this.activeJourney);
    this.notify();
  }

  /**
   * Telemetry point ingestion helper for programmatic/testing use
   */
  public ingestGpsPoint(pos: {
    coords: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      speed?: number | null;
      heading?: number | null;
      altitude?: number | null;
    };
    timestamp?: number;
  }): void {
    this.handleGpsUpdate(pos as unknown as GeolocationPosition);
  }

  /**
   * Explicit stationary evaluation trigger for testing
   */
  public triggerStationaryEvaluation(forceNow?: number): void {
    if (!this.activeJourney || this.activeJourney.status !== "recording" || !this.lastPoint) {
      return;
    }

    const now = forceNow ?? Date.now();
    if (!this.stationaryAnchorPoint) {
      this.stationaryAnchorPoint = this.lastPoint;
      return;
    }

    const distFromAnchor = haversineDistanceMeters(
      [this.stationaryAnchorPoint.longitude, this.stationaryAnchorPoint.latitude],
      [this.lastPoint.longitude, this.lastPoint.latitude]
    );

    const timeStationary = now - this.stationaryAnchorPoint.timestamp;

    if (!this.isDetectedStopped) {
      if (distFromAnchor <= STOP_DISTANCE_RADIUS_METERS && timeStationary >= STOP_DETECTION_TIME_MS) {
        this.isDetectedStopped = true;
        const stopLat = this.lastPoint.latitude;
        const stopLng = this.lastPoint.longitude;

        this.recordEvent({
          type: "stop_detected",
          name: "Stop detected",
          timestamp: now,
          latitude: stopLat,
          longitude: stopLng,
          accuracy: this.lastPoint.accuracy,
          details: `Stationary for ${Math.round(timeStationary / 1000)}s`,
        });
      }
    } else {
      if (distFromAnchor >= RESUME_DISTANCE_METERS) {
        this.isDetectedStopped = false;
        this.stationaryAnchorPoint = this.lastPoint;

        this.recordEvent({
          type: "journey_resumed",
          name: "Movement resumed",
          timestamp: now,
          latitude: this.lastPoint.latitude,
          longitude: this.lastPoint.longitude,
          accuracy: this.lastPoint.accuracy,
          details: `Resumed travel (${Math.round(distFromAnchor)}m from stop)`,
        });
      }
    }
  }
}

// Global singleton instance for app-wide continuity
let _recorderInstance: BlackBoxRecorder | null = null;

export function getBlackBoxRecorder(): BlackBoxRecorder {
  if (!_recorderInstance) {
    _recorderInstance = new BlackBoxRecorder();
  }
  return _recorderInstance;
}

export { BlackBoxRecorder as BlackBoxRecorderEngine };
