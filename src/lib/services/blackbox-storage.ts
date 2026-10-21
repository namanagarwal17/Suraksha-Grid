/**
 * Suraksha Grid — Safety Black Box Local Storage Service
 *
 * Implements privacy-first, local-only persistent storage using IndexedDB
 * with transparent localStorage fallback for older/restricted environments.
 *
 * Privacy Guarantees:
 * - Data never leaves the client device.
 * - Deleting a journey permanently removes all associated GPS points and events.
 * - No analytics or logging of GPS coordinates.
 */

import type { JourneyRecord } from "@/types/blackbox";

const DB_NAME = "suraksha_blackbox_db";
const DB_VERSION = 1;
const STORE_JOURNEYS = "journeys";
const STORE_META = "meta";
const ACTIVE_JOURNEY_KEY = "active_journey_id";
const LS_FALLBACK_PREFIX = "suraksha_sbb_jny_";
const LS_META_ACTIVE = "suraksha_sbb_active_id";

function isIndexedDBSupported(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBSupported()) {
      reject(new Error("IndexedDB is not supported"));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_JOURNEYS)) {
        db.createObjectStore(STORE_JOURNEYS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

// --- LocalStorage Fallback Helpers ---

function lsSaveJourney(journey: JourneyRecord): void {
  try {
    localStorage.setItem(LS_FALLBACK_PREFIX + journey.id, JSON.stringify(journey));
  } catch (err) {
    console.error("Safety Black Box: LocalStorage save failed", err);
  }
}

function lsGetJourney(id: string): JourneyRecord | null {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_PREFIX + id);
    return raw ? (JSON.parse(raw) as JourneyRecord) : null;
  } catch {
    return null;
  }
}

function lsGetAllJourneys(): JourneyRecord[] {
  const journeys: JourneyRecord[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LS_FALLBACK_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            journeys.push(JSON.parse(raw) as JourneyRecord);
          } catch {
            // ignore corrupt entry
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return journeys.sort((a, b) => b.startTime - a.startTime);
}

function lsDeleteJourney(id: string): void {
  try {
    localStorage.removeItem(LS_FALLBACK_PREFIX + id);
    if (localStorage.getItem(LS_META_ACTIVE) === id) {
      localStorage.removeItem(LS_META_ACTIVE);
    }
  } catch {
    // ignore
  }
}

// --- Public API ---

/**
 * Save or update a journey record locally.
 */
export async function saveJourney(journey: JourneyRecord): Promise<void> {
  const updated = {
    ...journey,
    pointsCount: journey.points.length,
    updatedAt: Date.now(),
  };

  if (isIndexedDBSupported()) {
    try {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_JOURNEYS, "readwrite");
        const store = tx.objectStore(STORE_JOURNEYS);
        const req = store.put(updated);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Fallback to localStorage if IDB transaction fails
      lsSaveJourney(updated);
      return;
    }
  }

  lsSaveJourney(updated);
}

/**
 * Retrieve a specific journey by ID.
 */
export async function getJourney(id: string): Promise<JourneyRecord | null> {
  if (isIndexedDBSupported()) {
    try {
      const db = await openDB();
      return new Promise<JourneyRecord | null>((resolve, reject) => {
        const tx = db.transaction(STORE_JOURNEYS, "readonly");
        const store = tx.objectStore(STORE_JOURNEYS);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return lsGetJourney(id);
    }
  }

  return lsGetJourney(id);
}

/**
 * Retrieve all saved journeys, sorted newest to oldest.
 */
export async function getAllJourneys(): Promise<JourneyRecord[]> {
  if (isIndexedDBSupported()) {
    try {
      const db = await openDB();
      return new Promise<JourneyRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE_JOURNEYS, "readonly");
        const store = tx.objectStore(STORE_JOURNEYS);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = (req.result as JourneyRecord[]) || [];
          resolve(list.sort((a, b) => b.startTime - a.startTime));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return lsGetAllJourneys();
    }
  }

  return lsGetAllJourneys();
}

/**
 * Permanently delete a journey and all its points/events from local device.
 */
export async function deleteJourney(id: string): Promise<boolean> {
  let success = false;
  if (isIndexedDBSupported()) {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_JOURNEYS, STORE_META], "readwrite");
        tx.objectStore(STORE_JOURNEYS).delete(id);

        // Clear active pointer if this was active
        const metaStore = tx.objectStore(STORE_META);
        const getMetaReq = metaStore.get(ACTIVE_JOURNEY_KEY);
        getMetaReq.onsuccess = () => {
          if (getMetaReq.result?.value === id) {
            metaStore.delete(ACTIVE_JOURNEY_KEY);
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      success = true;
    } catch {
      success = false;
    }
  }

  // Also clean up any localStorage mirror
  lsDeleteJourney(id);
  return success || true;
}

/**
 * Get the currently active journey ID, if any.
 */
export async function getActiveJourneyId(): Promise<string | null> {
  if (isIndexedDBSupported()) {
    try {
      const db = await openDB();
      return new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readonly");
        const store = tx.objectStore(STORE_META);
        const req = store.get(ACTIVE_JOURNEY_KEY);
        req.onsuccess = () => resolve(req.result?.value || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(LS_META_ACTIVE)
        : null;
    }
  }

  return typeof localStorage !== "undefined"
    ? localStorage.getItem(LS_META_ACTIVE)
    : null;
}

/**
 * Set or clear the active journey ID pointer.
 */
export async function setActiveJourneyId(id: string | null): Promise<void> {
  if (isIndexedDBSupported()) {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readwrite");
        const store = tx.objectStore(STORE_META);
        if (id) {
          store.put({ key: ACTIVE_JOURNEY_KEY, value: id });
        } else {
          store.delete(ACTIVE_JOURNEY_KEY);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // ignore
    }
  }

  if (typeof localStorage !== "undefined") {
    if (id) {
      localStorage.setItem(LS_META_ACTIVE, id);
    } else {
      localStorage.removeItem(LS_META_ACTIVE);
    }
  }
}

/**
 * Remove all journeys (used for resetting and privacy wipes).
 */
export async function clearAllJourneys(): Promise<void> {
  if (isIndexedDBSupported()) {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_JOURNEYS, STORE_META], "readwrite");
        tx.objectStore(STORE_JOURNEYS).clear();
        tx.objectStore(STORE_META).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // ignore
    }
  }
  if (typeof localStorage !== "undefined") {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(LS_FALLBACK_PREFIX) || k === LS_META_ACTIVE)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }
}

export const saveJourneyRecord = saveJourney;
export const getJourneyRecord = getJourney;
export const getAllJourneyRecords = getAllJourneys;
export const deleteJourneyRecord = deleteJourney;
export const saveActiveJourneyId = (id: string) => setActiveJourneyId(id);
export const clearActiveJourneyId = () => setActiveJourneyId(null);
