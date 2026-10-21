"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type {
  LngLat,
  GeolocationCoordinates,
  GeolocationError,
  GeolocationErrorCode,
  GeolocationState,
  GeolocationStatus,
} from "@/types";

export type {
  GeolocationCoordinates,
  GeolocationError,
  GeolocationErrorCode,
  GeolocationState,
  GeolocationStatus,
};

export interface GeolocationRequestOptions extends PositionOptions {
  /** Maximum age in milliseconds to accept a cached position from in-memory cache. Defaults to 60000 (1 min). */
  cacheTime?: number;
}

export interface UseGeolocationOptions extends GeolocationRequestOptions {
  /** Automatically request location on mount. Defaults to false. */
  autoRequest?: boolean;
  /** Continuously watch position changes. Defaults to false. */
  watch?: boolean;
}

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_CACHE_TIME = 60_000;

function isGeolocationSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "geolocation" in navigator
  );
}

let currentState: GeolocationState = {
  coords: null,
  lngLat: null,
  status: "idle",
  error: null,
  isLoading: false,
  isSupported: isGeolocationSupported(),
  timestamp: null,
};

type StateListener = (state: GeolocationState) => void;
const listeners = new Set<StateListener>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener(currentState));
}

let inFlightPromise: Promise<GeolocationState> | null = null;

function parseGeolocationError(err: GeolocationPositionError): GeolocationError {
  switch (err.code) {
    case 1: // GeolocationPositionError.PERMISSION_DENIED
      return {
        code: "PERMISSION_DENIED",
        message:
          "Location access was denied. Please allow location permissions in your browser settings.",
      };
    case 2: // GeolocationPositionError.POSITION_UNAVAILABLE
      return {
        code: "POSITION_UNAVAILABLE",
        message:
          "Unable to determine current position. Please check your network or GPS connection.",
      };
    case 3: // GeolocationPositionError.TIMEOUT
      return {
        code: "TIMEOUT",
        message: "Location request timed out. Please try again.",
      };
    default:
      return {
        code: "UNKNOWN_ERROR",
        message:
          err.message ||
          "An unknown error occurred while requesting your location.",
      };
  }
}

function toCoordinates(pos: GeolocationPosition): GeolocationCoordinates {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
    altitude: pos.coords.altitude ?? null,
    altitudeAccuracy: pos.coords.altitudeAccuracy ?? null,
    heading: pos.coords.heading ?? null,
    speed: pos.coords.speed ?? null,
  };
}

/**
 * Get current browser location with in-memory caching and request deduplication.
 * Avoids redundant GPS calls and prompts across components.
 */
export async function getCurrentLocation(
  options: GeolocationRequestOptions = {}
): Promise<GeolocationState> {
  const supported = isGeolocationSupported();
  if (!supported) {
    currentState = {
      ...currentState,
      isSupported: false,
      status: "error",
      isLoading: false,
      error: {
        code: "NOT_SUPPORTED",
        message: "Geolocation is not supported by this browser environment.",
      },
    };
    notifyListeners();
    return currentState;
  }

  const cacheTime = options.cacheTime ?? DEFAULT_CACHE_TIME;
  // Return cached coordinates if still valid and within cache window
  if (
    currentState.status === "success" &&
    currentState.coords &&
    currentState.timestamp &&
    Date.now() - currentState.timestamp < cacheTime
  ) {
    return currentState;
  }

  // Deduplicate in-flight requests
  if (inFlightPromise) {
    return inFlightPromise;
  }

  currentState = {
    ...currentState,
    isSupported: true,
    status: "loading",
    isLoading: true,
    error: null,
  };
  notifyListeners();

  const posOptions: PositionOptions = {
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    maximumAge: options.maximumAge ?? DEFAULT_CACHE_TIME,
  };

  inFlightPromise = new Promise<GeolocationState>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        inFlightPromise = null;
        const coords = toCoordinates(pos);
        const lngLat: LngLat = [coords.longitude, coords.latitude];
        currentState = {
          coords,
          lngLat,
          status: "success",
          isLoading: false,
          isSupported: true,
          error: null,
          timestamp: pos.timestamp || Date.now(),
        };
        notifyListeners();
        resolve(currentState);
      },
      (err) => {
        inFlightPromise = null;
        const error = parseGeolocationError(err);
        currentState = {
          ...currentState,
          status: "error",
          isLoading: false,
          isSupported: true,
          error,
        };
        notifyListeners();
        resolve(currentState);
      },
      posOptions
    );
  });

  return inFlightPromise;
}

/**
 * Watch continuous location updates.
 * Returns an unwatch cleanup function.
 */
export function watchLocation(
  onUpdate?: (state: GeolocationState) => void,
  options: PositionOptions = {}
): () => void {
  if (!isGeolocationSupported()) {
    const errorState: GeolocationState = {
      ...currentState,
      isSupported: false,
      status: "error",
      isLoading: false,
      error: {
        code: "NOT_SUPPORTED",
        message: "Geolocation is not supported by this browser environment.",
      },
    };
    onUpdate?.(errorState);
    return () => {};
  }

  const posOptions: PositionOptions = {
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    maximumAge: options.maximumAge ?? DEFAULT_CACHE_TIME,
  };

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const coords = toCoordinates(pos);
      const lngLat: LngLat = [coords.longitude, coords.latitude];
      currentState = {
        coords,
        lngLat,
        status: "success",
        isLoading: false,
        isSupported: true,
        error: null,
        timestamp: pos.timestamp || Date.now(),
      };
      notifyListeners();
      onUpdate?.(currentState);
    },
    (err) => {
      const error = parseGeolocationError(err);
      currentState = {
        ...currentState,
        status: "error",
        isLoading: false,
        isSupported: true,
        error,
      };
      notifyListeners();
      onUpdate?.(currentState);
    },
    posOptions
  );

  return () => {
    navigator.geolocation.clearWatch(watchId);
  };
}

/**
 * Clear in-memory cached location and error state.
 */
export function resetLocationState(): void {
  currentState = {
    coords: null,
    lngLat: null,
    status: "idle",
    error: null,
    isLoading: false,
    isSupported: isGeolocationSupported(),
    timestamp: null,
  };
  notifyListeners();
}

/**
 * React hook for consuming browser geolocation.
 * Subscribes to shared location state to avoid redundant GPS requests across components.
 */
export function useGeolocation(options: UseGeolocationOptions = {}) {
  const { autoRequest = false, watch = false, ...requestOpts } = options;
  const [state, setState] = useState<GeolocationState>(currentState);
  const optionsRef = useRef(requestOpts);
  optionsRef.current = requestOpts;

  useEffect(() => {
    // Sync with current state on mount
    setState(currentState);

    // Subscribe to state changes
    const listener: StateListener = (nextState) => {
      setState(nextState);
    };
    listeners.add(listener);

    let unwatch: (() => void) | null = null;

    if (watch) {
      unwatch = watchLocation(undefined, optionsRef.current);
    } else if (autoRequest) {
      if (currentState.status === "idle") {
        void getCurrentLocation(optionsRef.current);
      }
    }

    return () => {
      listeners.delete(listener);
      if (unwatch) unwatch();
    };
  }, [autoRequest, watch]);

  const requestLocation = useCallback(
    (customOptions?: GeolocationRequestOptions) => {
      return getCurrentLocation({ ...optionsRef.current, ...customOptions });
    },
    []
  );

  const clearError = useCallback(() => {
    currentState = {
      ...currentState,
      error: null,
      status: currentState.coords ? "success" : "idle",
    };
    notifyListeners();
  }, []);

  return {
    ...state,
    requestLocation,
    clearError,
  };
}
