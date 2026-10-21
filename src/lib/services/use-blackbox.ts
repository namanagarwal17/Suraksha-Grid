"use client";

import { useEffect, useState, useCallback } from "react";
import { getBlackBoxRecorder } from "./blackbox-recorder";
import type { ActiveRecordingState, JourneyRecord } from "@/types/blackbox";

export function useBlackBox() {
  const recorder = getBlackBoxRecorder();
  const [state, setState] = useState<ActiveRecordingState>(recorder.getState());

  useEffect(() => {
    return recorder.subscribe((next) => {
      setState(next);
    });
  }, [recorder]);

  const startJourney = useCallback(
    async (params?: {
      startLocationName?: string;
      destinationName?: string;
      initialCoords?: { latitude: number; longitude: number; accuracy?: number | null };
    }) => {
      return recorder.startJourney(params);
    },
    [recorder]
  );

  const pauseJourney = useCallback(async () => {
    return recorder.pauseJourney();
  }, [recorder]);

  const resumeJourney = useCallback(async () => {
    return recorder.resumeJourney();
  }, [recorder]);

  const completeJourney = useCallback(
    async (destinationName?: string) => {
      return recorder.completeJourney(destinationName);
    },
    [recorder]
  );

  const cancelJourney = useCallback(async () => {
    return recorder.cancelJourney();
  }, [recorder]);

  const restoreActive = useCallback(async () => {
    return recorder.tryRestoreActiveJourney();
  }, [recorder]);

  return {
    ...state,
    startJourney,
    pauseJourney,
    resumeJourney,
    completeJourney,
    cancelJourney,
    restoreActive,
  };
}
