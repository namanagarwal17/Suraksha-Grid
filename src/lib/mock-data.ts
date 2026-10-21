import type { LngLat } from "@/types";

/**
 * Geographic constants and default points of interest for Gurugram.
 * These are legitimate reference coordinates and labels used when
 * live GPS or search parameters are not yet provided.
 */
export const CURRENT_LOCATION = "Sector 14 Market, Gurugram";
export const DESTINATIONS = ["Cyber Hub", "Huda City Centre Metro", "Medanta Hospital", "Sector 29 Market"];
export const AREA_SUMMARY = { score: 78, note: "Mostly well-lit with steady foot traffic this evening." };

// Standard Gurugram reference coordinates [longitude, latitude]
export const ORIGIN: LngLat = [77.029, 28.428];        // Sector 14 reference point
export const DESTINATION: LngLat = [77.0965, 28.482];   // Cyber Hub reference point
