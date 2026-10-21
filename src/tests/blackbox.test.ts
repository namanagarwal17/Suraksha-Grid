/**
 * Safety Black Box — Complete Unit & Integration Test Suite
 * Tests:
 * 1. PDF Generation Engine (blackbox-pdf.ts)
 * 2. Black Box Storage Engine & Lifecycle (blackbox-storage.ts)
 * 3. Black Box Recording & Stop Detection Engine (blackbox-recorder.ts)
 * 4. Sharing & Fallback Engine (blackbox-share.ts)
 */

import { generateJourneyPdf } from "../lib/services/blackbox-pdf";
import {
  saveJourneyRecord,
  getJourneyRecord,
  getAllJourneyRecords,
  deleteJourneyRecord,
  saveActiveJourneyId,
  getActiveJourneyId,
  clearActiveJourneyId,
  clearAllJourneys,
} from "../lib/services/blackbox-storage";
import { BlackBoxRecorderEngine } from "../lib/services/blackbox-recorder";
import { shareJourneyPdf, canShareFiles } from "../lib/services/blackbox-share";
import type { JourneyRecord, JourneyPoint, JourneyEvent } from "../types/blackbox";

// --- Node Environment Setup for localStorage / IndexedDB polyfill ---
const storageMap = new Map<string, string>();
const mockLocalStorage: Storage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, String(value));
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
  key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  get length() {
    return storageMap.size;
  },
};

(global as any).localStorage = mockLocalStorage;
(global as any).window = {
  localStorage: mockLocalStorage,
};

// Simple test runner helper
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    testsFailed++;
    console.error(`  FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  testsPassed++;
  console.log(`  PASS: ${msg}`);
}

async function runTestSuite() {
  console.log("\n=======================================================");
  console.log("SURAKSHA GRID — Safety Black Box Test Suite");
  console.log("=======================================================\n");

  // -----------------------------------------------------------------
  // 1. PDF Generation Engine Tests
  // -----------------------------------------------------------------
  console.log("--- 1. Testing PDF Generation Engine (blackbox-pdf.ts) ---");

  const sampleJourney: JourneyRecord = {
    id: "journey_test_12345",
    title: "Journey to C-Scheme Central Park",
    startTime: 1729250000000,
    endTime: 1729252520000, // 42 minutes later
    durationSeconds: 2520,
    totalDistanceMeters: 4850,
    status: "completed",
    startLocationName: "Jaipur Junction Railway Station",
    destinationName: "C-Scheme Central Park",
    pointsCount: 4,
    hasInaccuratePoints: false,
    points: [
      {
        id: "pt_1",
        latitude: 26.9196,
        longitude: 75.7878,
        accuracy: 8.5,
        altitude: null,
        heading: null,
        speed: 0,
        timestamp: 1729250000000,
        source: "gps",
      },
      {
        id: "pt_2",
        latitude: 26.915,
        longitude: 75.792,
        accuracy: 10.2,
        altitude: null,
        heading: null,
        speed: 0,
        timestamp: 1729250840000,
        source: "gps",
      },
      {
        id: "pt_3",
        latitude: 26.912,
        longitude: 75.801,
        accuracy: 9.0,
        altitude: null,
        heading: null,
        speed: 0,
        timestamp: 1729251440000,
        source: "gps",
      },
      {
        id: "pt_4",
        latitude: 26.908,
        longitude: 75.806,
        accuracy: 7.8,
        altitude: null,
        heading: null,
        speed: 0,
        timestamp: 1729252520000,
        source: "gps",
      },
    ],
    events: [
      {
        id: "ev_1",
        type: "journey_started",
        name: "Journey Started",
        timestamp: 1729250000000,
        latitude: 26.9196,
        longitude: 75.7878,
        accuracy: 8.5,
        locationName: "Jaipur Junction Railway Station",
      },
      {
        id: "ev_2",
        type: "stop_detected",
        name: "Stop Detected",
        timestamp: 1729250840000,
        latitude: 26.915,
        longitude: 75.792,
        accuracy: 10.2,
        locationName: "Station Road Crossing",
        details: "Vehicle stationary for > 75 seconds",
      },
      {
        id: "ev_3",
        type: "journey_resumed",
        name: "Journey Resumed",
        timestamp: 1729251440000,
        latitude: 26.9152,
        longitude: 75.7921,
        accuracy: 9.0,
        locationName: "Station Road Crossing",
      },
      {
        id: "ev_4",
        type: "journey_completed",
        name: "Journey Completed",
        timestamp: 1729252520000,
        latitude: 26.908,
        longitude: 75.806,
        accuracy: 7.8,
        locationName: "C-Scheme Central Park",
      },
    ],
    createdAt: 1729250000000,
    updatedAt: 1729252520000,
  };

  const pdfBlob = await generateJourneyPdf(sampleJourney);
  assert(pdfBlob instanceof Blob, "generateJourneyPdf returns a Blob");
  assert(pdfBlob.type === "application/pdf", "Blob has MIME type application/pdf");
  assert(pdfBlob.size > 500, `PDF Blob has non-trivial size (${pdfBlob.size} bytes)`);

  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdfString = Buffer.from(arrayBuffer).toString("latin1");

  assert(pdfString.startsWith("%PDF-1.4"), "PDF binary starts with %PDF-1.4 magic header");
  assert(pdfString.includes("SURAKSHA GRID"), "PDF contains SURAKSHA GRID branding");
  assert(pdfString.includes("journey_test_12345"), "PDF contains Journey ID");
  assert(pdfString.includes("Journey Started"), "PDF contains Journey Started event");
  assert(pdfString.includes("Stop Detected"), "PDF contains Stop Detected event");
  assert(pdfString.includes("Journey Resumed"), "PDF contains Journey Resumed event");
  assert(pdfString.includes("Journey Completed"), "PDF contains Journey Completed event");
  assert(pdfString.includes("Jaipur Junction Railway Station"), "PDF contains starting location name");
  assert(pdfString.includes("%%EOF"), "PDF contains standard %%EOF marker");
  assert(pdfString.includes("trailer"), "PDF contains standard trailer dictionary");
  assert(
    pdfString.includes("Not Legally Certified Evidence"),
    "PDF includes legal advisory disclaimer not claiming tamper-proof evidence"
  );

  // Test empty points / missing location handling in PDF
  const sparseJourney: JourneyRecord = {
    id: "journey_sparse_999",
    title: "Sparse Journey",
    startLocationName: null,
    destinationName: null,
    startTime: 1729250000000,
    endTime: 1729250600000,
    durationSeconds: 600,
    totalDistanceMeters: 0,
    status: "completed",
    pointsCount: 0,
    hasInaccuratePoints: false,
    points: [],
    events: [
      {
        id: "ev_sparse_1",
        type: "journey_started",
        name: "Journey Started",
        timestamp: 1729250000000,
        accuracy: null,
      },
      {
        id: "ev_sparse_2",
        type: "journey_completed",
        name: "Journey Completed",
        timestamp: 1729250600000,
        accuracy: null,
      },
    ],
    createdAt: 1729250000000,
    updatedAt: 1729250600000,
  };

  const sparseBlob = await generateJourneyPdf(sparseJourney);
  const sparseString = Buffer.from(await sparseBlob.arrayBuffer()).toString("latin1");
  assert(
    sparseString.includes("No GPS track points recorded"),
    "PDF handles 0 GPS coordinates honestly without inventing synthetic coordinates"
  );
  assert(
    sparseString.includes("Location unavailable"),
    "PDF displays 'Location unavailable' for events lacking GPS fix"
  );

  // -----------------------------------------------------------------
  // 2. Storage Engine Tests (blackbox-storage.ts)
  // -----------------------------------------------------------------
  console.log("\n--- 2. Testing Black Box Storage Engine (blackbox-storage.ts) ---");

  await clearAllJourneys();
  assert((await getAllJourneyRecords()).length === 0, "clearAllJourneys empties storage");

  await saveJourneyRecord(sampleJourney);
  const retrieved = await getJourneyRecord(sampleJourney.id);
  assert(retrieved !== null, "getJourneyRecord retrieves saved journey");
  assert(retrieved?.id === sampleJourney.id, "Retrieved journey has identical ID");
  assert(retrieved?.points.length === 4, "Retrieved journey retains all 4 GPS points");
  assert(retrieved?.events.length === 4, "Retrieved journey retains all 4 events");

  // Save sparse journey as well
  await saveJourneyRecord(sparseJourney);
  const allJourneys = await getAllJourneyRecords();
  assert(allJourneys.length === 2, "getAllJourneyRecords lists both saved journeys");

  // Active Journey ID tracking
  await saveActiveJourneyId(sampleJourney.id);
  assert((await getActiveJourneyId()) === sampleJourney.id, "getActiveJourneyId returns current active ID");
  await clearActiveJourneyId();
  assert((await getActiveJourneyId()) === null, "clearActiveJourneyId removes active pointer");

  // Delete journey record & verify thorough cleanup
  await saveActiveJourneyId(sampleJourney.id);
  await deleteJourneyRecord(sampleJourney.id);
  assert((await getJourneyRecord(sampleJourney.id)) === null, "deleteJourneyRecord removes journey from storage");
  assert((await getActiveJourneyId()) === null, "deleteJourneyRecord clears active ID if deleted was active");
  assert((await getAllJourneyRecords()).length === 1, "Only remaining journey exists in storage");

  // Clean up
  await clearAllJourneys();

  // -----------------------------------------------------------------
  // 3. Recorder Engine Tests (blackbox-recorder.ts)
  // -----------------------------------------------------------------
  console.log("\n--- 3. Testing Recorder & Stop Detection Engine (blackbox-recorder.ts) ---");

  function mockNavigator(mockObj: any) {
    Object.defineProperty(globalThis, "navigator", {
      value: mockObj,
      configurable: true,
      writable: true,
    });
  }

  // Mock geolocation in test environment
  mockNavigator({
    geolocation: {
      watchPosition: () => 1,
      clearWatch: () => {},
      getCurrentPosition: (cb: any) => cb({ coords: { latitude: 26.9239, longitude: 75.7997 } }),
    },
  });

  const recorder = new BlackBoxRecorderEngine();

  // 3.1 Start journey
  const j1 = await recorder.startJourney({
    startLocationName: "Sindhi Camp Bus Station",
    destinationName: "Amer Fort",
    initialCoords: {
      latitude: 26.9239,
      longitude: 75.7997,
      accuracy: 6.5,
    },
  });

  assert(j1.status === "recording", "startJourney sets status to recording");
  assert(j1.points.length === 1, "startJourney adds initial point");
  assert(j1.events.length === 1, "startJourney records journey_started event");
  assert(recorder.isActivelyRecording(), "recorder.isActivelyRecording() returns true");

  // 3.2 Add moving points
  const t1 = Date.now() + 30000;
  recorder.ingestGpsPoint({
    coords: {
      latitude: 26.927,
      longitude: 75.803,
      accuracy: 7.0,
    },
    timestamp: t1,
  });

  assert(recorder.getActiveJourney()?.points.length === 2, "Moving point is recorded");

  // 3.3 Test throttling of redundant/static jitter points within 1 second or < 5m
  recorder.ingestGpsPoint({
    coords: {
      latitude: 26.927001,
      longitude: 75.803001,
      accuracy: 7.0,
    },
    timestamp: t1 + 500, // jitter
  });

  assert(
    recorder.getActiveJourney()?.points.length === 2,
    "Insignificant jitter / high-frequency updates are throttled to save battery"
  );

  // 3.4 Inactivity Stop Detection (Stationary for >= 75 seconds)
  recorder.triggerStationaryEvaluation(t1 + 85000);

  const journeyAfterStop = recorder.getActiveJourney();
  const stopEvent = journeyAfterStop?.events.find((e) => e.type === "stop_detected");
  assert(stopEvent !== undefined, "Stop is automatically detected after 85s of stationary coordinates");
  assert(stopEvent?.name === "Stop detected", "Stop event named 'Stop detected'");

  // 3.5 Movement Resumption
  recorder.ingestGpsPoint({
    coords: {
      latitude: 26.938,
      longitude: 75.815,
      accuracy: 6.0,
    },
    timestamp: t1 + 100000,
  });
  recorder.triggerStationaryEvaluation(t1 + 100000);

  const journeyAfterResume = recorder.getActiveJourney();
  const resumeEvent = journeyAfterResume?.events.find((e) => e.type === "journey_resumed");
  assert(resumeEvent !== undefined, "journey_resumed event automatically detected after movement restarts");

  // 3.6 Manual Pause & Resume
  await recorder.pauseJourney();
  assert(recorder.getActiveJourney()?.status === "paused", "pauseJourney updates status to paused");
  const pauseEvent = recorder.getActiveJourney()?.events.find((e) => e.type === "manual_pause");
  assert(pauseEvent !== undefined, "manual_pause event recorded distinctly from automatic stop");

  await recorder.resumeJourney();
  assert(recorder.getActiveJourney()?.status === "recording", "resumeJourney updates status to recording");
  const manualResumeEvent = recorder.getActiveJourney()?.events.find((e) => e.type === "manual_resume");
  assert(manualResumeEvent !== undefined, "manual_resume event recorded distinctly");

  // 3.7 Complete Journey
  const completedJourney = await recorder.completeJourney("Amer Fort");

  assert(completedJourney.status === "completed", "completeJourney sets status to completed");
  assert(completedJourney.endTime !== null, "completeJourney sets endTime");
  assert(completedJourney.totalDistanceMeters > 0, "completeJourney computes positive total distance");
  const completedEvent = completedJourney.events.find((e) => e.type === "journey_completed");
  assert(completedEvent !== undefined, "completeJourney adds journey_completed event to timeline");
  assert(!recorder.isActivelyRecording(), "isActivelyRecording returns false after completion");

  // -----------------------------------------------------------------
  // 4. Sharing & Fallback Engine Tests (blackbox-share.ts)
  // -----------------------------------------------------------------
  console.log("\n--- 4. Testing Sharing & Fallback Engine (blackbox-share.ts) ---");

  // When navigator.share is unavailable
  mockNavigator({});
  assert(!canShareFiles(), "canShareFiles returns false when navigator.share is undefined");

  let downloadTriggered = false;
  // Mock document.createElement, body, and click for download fallback test
  (global as any).document = {
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    createElement: (tag: string) => ({
      tagName: tag,
      href: "",
      download: "",
      click: () => {
        downloadTriggered = true;
      },
    }),
  };
  (global as any).URL = {
    createObjectURL: () => "blob:mock-url",
    revokeObjectURL: () => {},
  };

  const pdfBlobForShare = await generateJourneyPdf(completedJourney);
  const shareResult = await shareJourneyPdf(completedJourney, pdfBlobForShare);

  assert(shareResult.method === "download", "shareJourneyPdf cleanly falls back to 'download' method");
  assert(Boolean(shareResult.success), "Fallback download reports success");
  assert(Boolean(downloadTriggered), "Anchor click triggered for direct file download");

  // When native navigator.canShare & navigator.share ARE available
  let nativeShareCalled = false;
  mockNavigator({
    canShare: (data: any) => Boolean(data && data.files),
    share: async (data: any) => {
      nativeShareCalled = true;
      assert(data.files && data.files.length === 1, "Native share receives actual PDF file object");
      assert(data.files[0].name.endsWith(".pdf"), "Shared file has .pdf extension");
    },
  });
  assert(Boolean(canShareFiles()), "canShareFiles returns true when navigator.canShare accepts files");

  const nativeResult = await shareJourneyPdf(completedJourney, pdfBlobForShare);
  assert(nativeResult.method === "native", "shareJourneyPdf uses 'native' when supported");
  assert(Boolean(nativeShareCalled), "Native navigator.share was invoked");

  // Clean up
  await clearAllJourneys();

  console.log("\n=======================================================");
  console.log(`ALL TESTS PASSED: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log("=======================================================\n");
}

runTestSuite().catch((err) => {
  console.error("Test Suite Failed with Error:", err);
  process.exit(1);
});
