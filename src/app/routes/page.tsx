"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  MapPin,
  X,
  Footprints,
  Car,
  Bike,
} from "lucide-react";
import { MapLayout } from "@/components/map/map-layout";
import { MapLibreMap } from "@/components/map/maplibre-map";
import { RouteCard } from "@/components/navigation/route-card";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchRoutes, planRealRoute, type RouteResult } from "@/lib/services/routes";
import { saveRoute, checkIsRouteSaved } from "@/lib/services/profile";
import { getUser } from "@/lib/services/auth";
import { searchDestinations, type SearchResult } from "@/lib/services/geocoding";
import { DESTINATION } from "@/lib/mock-data";
import { useGeolocation } from "@/lib/location";
import { fetchCrimeGeoJSON, type CrimeGeoJSON } from "@/lib/services/crime";
import type { LngLat, MapMarker, RouteId } from "@/types";

export default function RoutesPage() {
  const searchParams = useSearchParams();
  const initialTo = searchParams.get("to") ?? "";
  const paramDestLng = searchParams.get("destLng");
  const paramDestLat = searchParams.get("destLat");
  const paramDestName = searchParams.get("destName");

  const [sel, setSel] = useState<RouteId>("balanced");
  const [data, setData] = useState<RouteResult[] | null>(null);
  const [loading, setLoading] = useState(Boolean(initialTo || (paramDestLng && paramDestLat)));
  const [routeError, setRouteError] = useState<string | null>(null);
  const [profile, setProfile] = useState<"foot-walking" | "driving-car" | "cycling-regular">("foot-walking");

  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [crimeGeoJSON, setCrimeGeoJSON] = useState<CrimeGeoJSON | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCrimeGeoJSON().then((fc) => {
      if (alive && fc && fc.features.length > 0) {
        setCrimeGeoJSON(fc);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Search state
  const [searchQuery, setSearchQuery] = useState(initialTo || (paramDestName ?? ""));
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedDest, setSelectedDest] = useState<{
    name: string;
    coordinates: LngLat;
  } | null>(() => {
    if (paramDestLng && paramDestLat) {
      const lng = parseFloat(paramDestLng);
      const lat = parseFloat(paramDestLat);
      if (!isNaN(lng) && !isNaN(lat)) {
        return {
          name: paramDestName || "Selected Destination",
          coordinates: [lng, lat],
        };
      }
    }
    return null;
  });

  const { lngLat: userLngLat, isLoading: isGeoLoading } = useGeolocation({ autoRequest: true });
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to plan real route using OpenRouteService
  const generateRealRoutes = useCallback(
    async (
      origin: LngLat,
      destCoords: LngLat,
      activeProfile: "foot-walking" | "driving-car" | "cycling-regular" = profile
    ) => {
      // Clear stale routes immediately when a new calculation starts
      setData(null);
      setLoading(true);
      setRouteError(null);
      try {
        const res = await planRealRoute({
          origin,
          destination: destCoords,
          profile: activeProfile,
        });

        if (res.source === "openrouteservice" && res.routes.length > 0) {
          setData(res.routes);
          const recommended =
            res.routes.find((route) => route.recommended) ?? res.routes[0];
          if (recommended) setSel(recommended.id);
        } else {
          setData([]);
          setRouteError(
            res.error || "Unable to calculate route to this destination with OpenRouteService."
          );
        }
      } catch (err) {
        setData([]);
        setRouteError(
          err instanceof Error ? err.message : "Routing service unavailable."
        );
      } finally {
        setLoading(false);
      }
    },
    [profile]
  );

  // Initial route resolution — only triggered if destination is explicitly provided
  useEffect(() => {
    let alive = true;

    // 1. If explicit destination coordinates provided via deep link
    if (selectedDest) {
      if (userLngLat) {
        void generateRealRoutes(userLngLat, selectedDest.coordinates);
      } else {
        setLoading(false);
        setRouteError("GPS location unavailable. Please grant location permissions to plan routes from your position.");
      }
      return;
    }

    // 2. If 'to' text parameter provided via deep link, geocode it
    if (initialTo) {
      setIsSearching(true);
      setLoading(true);
      searchDestinations(initialTo, userLngLat)
        .then((results) => {
          if (!alive) return;
          setIsSearching(false);
          if (results.length > 0) {
            const top = results[0];
            setSelectedDest({ name: top.name, coordinates: top.coordinates });
            setSearchQuery(top.name);
            if (userLngLat) {
              void generateRealRoutes(userLngLat, top.coordinates);
            } else {
              setLoading(false);
              setRouteError("GPS location unavailable. Please grant location permissions to plan routes from your position.");
            }
          } else {
            // Geocoding returned 0 results
            setRouteError(`Could not find location "${initialTo}".`);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!alive) return;
          setIsSearching(false);
          setRouteError(`Geocoding failed for "${initialTo}".`);
          setLoading(false);
        });
      return;
    }

    // 3. No explicit destination provided — show no route cards and no route lines
    setLoading(false);
    setData(null);

    return () => {
      alive = false;
    };
  }, [initialTo, userLngLat, generateRealRoutes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search for destination input
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    if (selectedDest && searchQuery === selectedDest.name) {
      return;
    }

    setIsSearching(true);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    searchDebounceRef.current = setTimeout(() => {
      let alive = true;
      searchDestinations(searchQuery, userLngLat)
        .then((results) => {
          if (alive) {
            setSearchResults(results);
            setShowSuggestions(true);
            setIsSearching(false);
          }
        })
        .catch(() => {
          if (alive) {
            setSearchResults([]);
            setIsSearching(false);
          }
        });
      return () => {
        alive = false;
      };
    }, 300);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, userLngLat, selectedDest]);

  const handleSelectSearchResult = useCallback(
    (item: SearchResult) => {
      setSelectedDest({ name: item.name, coordinates: item.coordinates });
      setSearchQuery(item.name);
      setShowSuggestions(false);
      setData(null);
      setRouteError(null);
      if (userLngLat) {
        void generateRealRoutes(userLngLat, item.coordinates, profile);
      } else {
        setRouteError("Location unavailable. Enable GPS permissions to plan routes from your position.");
      }
    },
    [userLngLat, generateRealRoutes, profile]
  );

  const handleSearchSubmit = useCallback(async () => {
    if (searchResults.length > 0) {
      handleSelectSearchResult(searchResults[0]);
      return;
    }
    const q = searchQuery.trim();
    if (q.length >= 2) {
      setIsSearching(true);
      try {
        const results = await searchDestinations(q, userLngLat);
        setIsSearching(false);
        if (results.length > 0) {
          setSearchResults(results);
          handleSelectSearchResult(results[0]);
        } else {
          setShowSuggestions(true);
        }
      } catch {
        setIsSearching(false);
      }
    }
  }, [searchResults, searchQuery, userLngLat, handleSelectSearchResult]);

  const handleProfileChange = useCallback(
    (newProfile: "foot-walking" | "driving-car" | "cycling-regular") => {
      setProfile(newProfile);
      if (selectedDest && userLngLat) {
        void generateRealRoutes(userLngLat, selectedDest.coordinates, newProfile);
      }
    },
    [selectedDest, userLngLat, generateRealRoutes]
  );

  const route = data?.find((r) => r.id === sel);

  // Check if current route is saved whenever selection changes
  useEffect(() => {
    let alive = true;
    setSaveMessage(null);
    setSaveError(null);

    void checkIsRouteSaved({
      routeId: route?.dbId,
      routeType: sel,
    }).then((saved) => {
      if (alive) setIsSaved(saved);
    });

    return () => {
      alive = false;
    };
  }, [sel, route?.dbId]);

  const handleSaveRoute = useCallback(async () => {
    if (!route || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const user = await getUser();
      if (!user) {
        setSaveError("Please sign in to save routes to your profile.");
        setSaving(false);
        return;
      }

      const res = await saveRoute({
        routeId: route.dbId,
        routeType: sel,
        name: route.name,
      });

      if (res.ok) {
        setIsSaved(true);
        setSaveMessage(
          res.alreadySaved
            ? "Route is already saved in your Profile."
            : "Route saved! You can access it anytime from your Profile."
        );
      } else {
        setSaveError(res.error ?? "Failed to save route.");
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save route.");
    } finally {
      setSaving(false);
    }
  }, [route, sel, saving]);

  // Destination coordinates for map and navigation
  const effectiveDestCoords: LngLat =
    selectedDest?.coordinates ??
    (route?.coords?.length
      ? route.coords[route.coords.length - 1]
      : DESTINATION);

  const endpoints: MapMarker[] = [
    ...(userLngLat
      ? [
          {
            id: "you",
            x: 0,
            y: 0,
            lng: userLngLat[0],
            lat: userLngLat[1],
            kind: "you" as const,
            label: "You (GPS)",
          },
        ]
      : []),
    ...(route?.coords?.length
      ? [
          {
            id: "dest",
            x: 0,
            y: 0,
            lng: effectiveDestCoords[0],
            lat: effectiveDestCoords[1],
            kind: "dest" as const,
            label: selectedDest?.name ?? "Destination",
          },
        ]
      : []),
  ];

  const handleStartNavigation = () => {
    if (!route) return;
    try {
      sessionStorage.setItem("suraksha_active_route", JSON.stringify(route));
      sessionStorage.setItem(
        "suraksha_active_dest",
        JSON.stringify({
          name: selectedDest?.name ?? route.name,
          coordinates: effectiveDestCoords,
        })
      );
    } catch {
      // sessionStorage non-fatal
    }
  };

  const navUrl = `/navigation?route=${sel}&destLng=${effectiveDestCoords[0]}&destLat=${effectiveDestCoords[1]}&destName=${encodeURIComponent(
    selectedDest?.name ?? "Destination"
  )}&profile=${profile}${userLngLat ? `&origLng=${userLngLat[0]}&origLat=${userLngLat[1]}` : ""}`;

  return (
    <MapLayout
      map={
        <div className="relative h-full w-full">
          <MapLibreMap
            className="h-full w-full"
            routeLines={
              data && data.length > 0
                ? data.map((r) => ({
                    route: r,
                    coords: r.coords,
                  }))
                : []
            }
            selectedRouteId={sel}
            onSelectRoute={setSel}
            markers={endpoints}
            crimeGeoJSON={crimeGeoJSON}
            showCrimeOverlay={true}
          />
          {loading && (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
              <div className="flex items-center gap-2 rounded-full border border-line bg-white/95 px-4 py-2 text-xs font-semibold text-foreground shadow-md backdrop-blur">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                <span>Calculating safe routes with OpenRouteService…</span>
              </div>
            </div>
          )}
        </div>
      }
      panel={
        <div className="space-y-3">
          <div>
            <h1 className="text-xl font-bold">Choose your route</h1>
            <p className="text-sm text-muted">
              {userLngLat
                ? `GPS Origin (${userLngLat[1].toFixed(3)}, ${userLngLat[0].toFixed(3)}) → ${
                    selectedDest?.name ?? "Destination"
                  }`
                : isGeoLoading
                ? "Acquiring GPS location…"
                : selectedDest
                ? `Destination: ${selectedDest.name} · GPS location unavailable`
                : "GPS location unavailable"}
            </p>
            {!userLngLat && (
              <p className="mt-1 text-[11px] text-muted/80">
                Enable browser location permissions to calculate real-time safe routes from your position.
              </p>
            )}
          </div>

          {/* Search Destination Box */}
          <div className="relative">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 shadow-sm focus-within:border-brand">
              <button
                type="button"
                aria-label="Search destination"
                title="Search"
                onClick={() => void handleSearchSubmit()}
                className="p-1 text-muted hover:text-brand transition cursor-pointer"
              >
                <Search className="h-4 w-4 shrink-0" />
              </button>
              <input
                aria-label="Search destination"
                placeholder="Search destination (e.g. Cyber Hub, Metro…)"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => {
                  if (searchResults.length > 0) setShowSuggestions(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSearchSubmit();
                  }
                }}
                className="h-10 flex-1 bg-transparent text-sm outline-none"
              />
              {isSearching && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
              )}
              {searchQuery && !isSearching && (
                <button
                  type="button"
                  aria-label="Clear destination"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                    setShowSuggestions(false);
                    setSelectedDest(null);
                    setData(null);
                    setRouteError(null);
                  }}
                  className="rounded-full p-1 text-muted hover:bg-surface"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {showSuggestions && searchResults.length > 0 && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-white shadow-card">
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectSearchResult(item)}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition hover:bg-surface"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-foreground">
                        {item.name}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {item.fullName}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Travel Mode Selector */}
          <div className="flex items-center gap-1.5 rounded-xl border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => handleProfileChange("foot-walking")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition",
                profile === "foot-walking"
                  ? "bg-white text-brand shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              <Footprints className="h-3.5 w-3.5" />
              Walking
            </button>
            <button
              type="button"
              onClick={() => handleProfileChange("driving-car")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition",
                profile === "driving-car"
                  ? "bg-white text-brand shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              <Car className="h-3.5 w-3.5" />
              Driving
            </button>
            <button
              type="button"
              onClick={() => handleProfileChange("cycling-regular")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition",
                profile === "cycling-regular"
                  ? "bg-white text-brand shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              <Bike className="h-3.5 w-3.5" />
              Cycling
            </button>
          </div>

          {data && data.length > 0 ? (
            <div className="space-y-3 pt-2">
              {data.map((r) => (
                <RouteCard
                  key={r.id}
                  route={r}
                  selected={r.id === sel}
                  onSelect={() => setSel(r.id)}
                />
              ))}
            </div>
          ) : loading ? (
            <div className="space-y-3 pt-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : routeError ? (
            <div className="rounded-2xl border border-concern/30 bg-concern/5 p-4 text-sm text-concern">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Routing Error</span>
              </div>
              <p className="mt-1 text-xs text-muted">{routeError}</p>
              {selectedDest && userLngLat && (
                <button
                  type="button"
                  onClick={() => void generateRealRoutes(userLngLat, selectedDest.coordinates)}
                  className="mt-3 text-xs font-semibold text-brand hover:underline"
                >
                  Retry calculation
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-surface/50 p-6 text-center text-sm text-muted">
              <MapPin className="mx-auto mb-2 h-6 w-6 text-brand/60" />
              <p className="font-semibold text-foreground">Select a destination</p>
              <p className="mt-1 text-xs">
                Search a destination or select from suggestions above to calculate real-time safe routes.
              </p>
            </div>
          )}

          {route && (
            <div className="space-y-2 pt-1">
              <Link
                href={navUrl}
                onClick={handleStartNavigation}
                className={cn(buttonVariants({ size: "lg" }), "w-full")}
              >
                Start {route.name} route <ArrowRight className="h-4 w-4" />
              </Link>

              <button
                type="button"
                onClick={() => void handleSaveRoute()}
                disabled={saving}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-2xl border py-2.5 text-sm font-semibold transition",
                  isSaved
                    ? "border-safer/40 bg-safer/10 text-safer"
                    : "border-line bg-white hover:border-brand/40 text-foreground",
                )}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-brand" />
                    Saving route…
                  </>
                ) : isSaved ? (
                  <>
                    <BookmarkCheck className="h-4 w-4 text-safer" />
                    Saved to Profile
                  </>
                ) : (
                  <>
                    <Bookmark className="h-4 w-4 text-muted" />
                    Save {route.name} route
                  </>
                )}
              </button>

              {saveMessage && (
                <div className="flex items-center gap-2 rounded-xl bg-safer/10 p-2.5 text-xs font-semibold text-safer">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{saveMessage}</span>
                </div>
              )}

              {saveError && (
                <div className="flex items-center gap-2 rounded-xl bg-concern/10 p-2.5 text-xs font-semibold text-concern">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>
          )}
        </div>
      }
    />
  );
}
