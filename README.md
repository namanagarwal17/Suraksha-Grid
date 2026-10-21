# Suraksha Grid

**Navigate Smarter. Travel Safer.**

Safety-aware navigation web app — Next.js frontend + FastAPI backend + Supabase (PostgreSQL + PostGIS).

---

## Required environment variables

Copy `.env.example` to `.env.local` (Next.js) and `backend/.env.example` to `backend/.env` (FastAPI).
**Never commit real values.**

| Variable | Where used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js client | Public, safe to ship to browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js client | Public anon key; RLS enforces access |
| `NEXT_PUBLIC_MAPTILER_KEY` | Next.js client | MapTiler public client token for the production basemap. Get a free key at https://cloud.maptiler.com/account/keys/ — restrict it to your domain in the MapTiler console. Falls back to demotiles when absent. |
| `SUPABASE_SERVICE_ROLE_KEY` | FastAPI **only** | Never expose to browser |
| `OPENROUTESERVICE_API_KEY` | FastAPI **only** | OpenRouteService token for real road network routing |
| `DATABASE_URL` | FastAPI / migrations | Supabase Postgres connection string |
| `FASTAPI_BASE_URL` | Next.js server | Default: `http://localhost:8000` |
| `ALLOWED_ORIGINS` | FastAPI CORS | Comma-separated, e.g. `http://localhost:3000` |

---

## Database — run migrations

Migrations live in `supabase/migrations/` and must be run in order.

**With the Supabase CLI (recommended):**

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

**Manually via psql:**

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/002_rls.sql
psql "$DATABASE_URL" -f supabase/migrations/003_realtime.sql
```

After running migrations, generate fresh TypeScript types:

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID \
  > src/lib/supabase/types.ts
```

---

## Start the Next.js frontend

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

The app works without Supabase configured — all pages fall back to typed mock data.

---

## Start the FastAPI backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # fill in your values
./run.sh                # uvicorn on :8000
```

Swagger docs: http://localhost:8000/docs  
Health check: http://localhost:8000/health

Run backend tests:

```bash
cd backend && pytest tests/ -v
```

---

## Supabase configuration

1. Create a project at https://supabase.com
2. Enable PostGIS: *Project settings → Extensions → postgis*
3. Run the migrations above
4. In *Authentication → URL Configuration* set:
   - Site URL: `http://localhost:3000`
   - Redirect URL: `http://localhost:3000/auth/callback`
5. In *Realtime → Tables*, confirm `safety_reports` and `road_segments` appear
   (migration 003 adds them to the publication)
6. Copy your project URL and anon key to `.env.local`

---

## Phase status

| Phase | Description | Status |
|---|---|---|
| 0 + 1 | Foundation + full frontend (9 pages, mock data) | ✅ Complete |
| 2 | MapLibre GL real map, routing abstraction | ✅ Complete |
| 3 | Supabase schema + RLS, FastAPI backend, auth foundation, realtime architecture | ✅ Complete |
| 4 | Safety Intelligence Engine (Gemini + score recalculation) | Planned |

---

## Architecture notes

- All pages fall back to `src/lib/mock-data.ts` when Supabase env vars are absent.
- The `MapLibreMap` component uses MapTiler Streets v2 (OSM-derived) as the production basemap, configured via `NEXT_PUBLIC_MAPTILER_KEY`. Set this variable in `.env.local` (copy from `.env.example`). When the variable is absent the component falls back to the MapLibre demotiles placeholder.
- The `src/types/vendor/maplibre-gl.d.ts` shim can be deleted once `npm install` has run (the real package ships its own types).

## Phase 5 additions

### Gemini integration (FastAPI backend)
Set `GEMINI_API_KEY` in `backend/.env`. When present, free-text reports are sent to Gemini Flash for signal extraction (category, severity, lighting, time context). Gemini is **never** the scoring authority — the Safety Engine remains the sole source of Safety Scores.

If Gemini is unavailable (missing key, timeout, malformed response), reports are stored with rule-based signals. No fake output is ever produced.

### Report submission flow
`POST /api/reports` (Next.js) → validates → proxies to FastAPI → Gemini analysis → Supabase insert → segment recalculation → Realtime update.

### Community evidence
`src/lib/community-evidence.ts` — typed aggregator for community reports. Decay-weighted impact, agreement level, dominant category. Feeds the Safety Engine's `reports` input. A small number of reports never implies certainty.

### Realtime recalculation (Phase 4 + 5 complete)
`src/app/api/recalculate/[segmentId]/route.ts` — Next.js server-side proxy so the browser never holds FastAPI credentials. Map page mounts `subscribeToReports()` and can call this route when a new report arrives for a known segment.

### Street Stories
Connected to Supabase via `src/lib/services/stories.ts`. Helpful votes call `increment_helpful` RPC. Falls back to mock data when Supabase is unavailable.

### TypeScript cleanup (Phase 5-A)
- MapLibre vendor shim rewritten with proper `IControl`, `GeoJSONSource`, `GeoJSON` namespace.
- `tsconfig.json` `typeRoots` override removed (was shadowing installed packages).
- Supabase `types.ts` rewritten with `Relationships`, `Functions` block for all three RPCs, no `geometry::json` cast.
- `server.ts` and `middleware.ts` cookie callbacks typed with explicit `CookieOptions`.
- `auth.ts` — removed erroneous `"use client"` directive from a pure utility module.
- `segments.ts` — removed invalid `geometry::json` cast from select string.
- `stories.ts` — removed profiles join that caused `never` inference.
- `maplibre-map.tsx` — uses `InstanceType<typeof maplibregl.Map>` instead of `import()` alias.


## Phase 6 — Final Integration + Hackathon Polish

### Emergency Safety Alert
Available from the Map and Navigation pages. Default 60-second countdown with cancel.

Email: configure `RESEND_API_KEY` in `backend/.env`. Email sent via [Resend](https://resend.com).
SMS: **SIMULATED in demo mode** (`DemoSmsProvider`). No real SMS is ever sent or claimed.
Future: add a real provider (Twilio, Fast2SMS) by implementing the `SmsProvider` ABC in `backend/app/services/emergency.py`.

### Gemini Vision
`backend/app/services/vision.py` — accepts base64 images, returns lighting/obstruction/accessibility signals.
Does NOT identify people or produce Safety Scores.

### Run commands (quick reference)
```bash
# Frontend
npm install && npm run dev

# Backend
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload

# Run migrations
npx supabase db push
```

### Environment variables (all)
| Variable | Used by | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js browser | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js browser | Yes |
| `NEXT_PUBLIC_MAPTILER_KEY` | Next.js browser | Yes (for production basemap) — falls back to demotiles if absent |
| `SUPABASE_SERVICE_ROLE_KEY` | FastAPI only | Yes |
| `OPENROUTESERVICE_API_KEY` | FastAPI only | Yes (for real road routing) |
| `DATABASE_URL` | FastAPI / migrations | Yes |
| `FASTAPI_BASE_URL` | Next.js server | No (default `:8000`) |
| `ALLOWED_ORIGINS` | FastAPI CORS | No |
| `GEMINI_API_KEY` | FastAPI only | No (rule-based fallback) |
| `RESEND_API_KEY` | FastAPI only | No (email skipped) |

### Demo limitations
- Safety scores are from synthetic/demo data — not real-world observations
- SMS is always simulated (`DemoSmsProvider`) — no real SMS is ever sent
- MapLibre uses MapTiler Streets v2 (OSM) when `NEXT_PUBLIC_MAPTILER_KEY` is set; falls back to `demotiles.maplibre.org` when the key is absent
- GPS uses a fixed demo coordinate (`ORIGIN` in `src/lib/mock-data.ts`)
- `npm run typecheck` and `npm run build` require `npm install` (npm registry blocked in CI sandbox)
- `pytest` requires `pip install -r requirements.txt` (pip registry blocked in CI sandbox)
