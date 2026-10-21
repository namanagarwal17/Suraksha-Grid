# SURAKSHA GRID

### Safety-Aware Navigation for Smarter and Safer Mobility

SURAKSHA GRID is a safety-aware navigation platform designed to help people make more informed travel decisions. It combines route planning with historical crime intelligence, community-generated safety information, and journey documentation.

Instead of focusing only on the shortest or fastest route, SURAKSHA GRID provides multiple route options so users can consider both travel time and available safety-related signals.

---

## Key Features

### 1. Safety-Aware Route Planning

* Compare multiple route options: **Fastest, Balanced, and Safest**.
* Uses OpenRouteService for route planning.
* Displays routes through an interactive map interface.
* Combines available safety-related information to support route comparison.

### 2. Safety Intelligence Engine

* Uses historical crime data from NCRB 2023.
* Incorporates geospatial information for safety analysis.
* Considers community reports and other available safety signals.
* Presents safety information to support informed decisions.

**Note:** Historical crime data represents past recorded incidents and should not be interpreted as real-time or street-level crime information.

### 3. Community Safety Reporting

* Users can submit reports about incidents or unsafe locations.
* Supports categories, severity, descriptions, and location information.
* Allows optional image uploads.
* Uses Gemini-powered analysis for extracting useful information from submitted reports.

### 4. Safety Black Box — Journey Documentation

A journey documentation feature that records important journey information.

* Tracks GPS locations during a journey.
* Records journey events and timestamps.
* Supports starting, pausing, resuming, and completing journeys.
* Generates a journey report after completion.
* Displays the journey map and event timeline.
* Allows users to download and share the generated PDF report.

The user remains in control of generating the report.

### 5. Emergency Alert

* Provides an emergency alert interface.
* Includes a 60-second countdown with a cancellation option.
* Supports email notifications through Resend when configured.

### 6. Street Stories

A community-driven feature where users can explore and share local travel experiences and safety-related information.

### 7. Nearby Help

Helps users locate nearby assistance points, including:

* Police stations
* Hospitals
* Other available help locations

### 8. Gemini Vision Integration

Uses image analysis to identify environmental observations such as:

* Lighting conditions
* Road obstructions
* Accessibility-related observations

These observations are intended to provide additional environmental context.

---

## Complete User Workflow

1. User enters their starting point and destination.
2. The platform fetches available route alternatives.
3. The Safety Intelligence Engine evaluates available safety-related signals.
4. Users compare Fastest, Balanced, and Safest route options.
5. User selects a preferred route.
6. Journey tracking can be started.
7. The platform records journey locations and relevant events.
8. After completing the journey, the user can generate a Journey Report.
9. The report presents the journey map, timeline, and recorded information.
10. Users can download or share the report as a PDF.

Additional features such as Community Reporting, Street Stories, Nearby Help, and Emergency Alert provide broader safety support.

---

## Technology Stack

| Category            | Technologies                  |
| ------------------- | ----------------------------- |
| Frontend            | Next.js, React, TypeScript    |
| Styling             | Tailwind CSS                  |
| Backend             | Python, FastAPI               |
| Database            | Supabase, PostgreSQL, PostGIS |
| Maps                | MapLibre GL, MapTiler         |
| Route Planning      | OpenRouteService              |
| AI Integration      | Google Gemini, Gemini Vision  |
| Email Notifications | Resend                        |

---

## Project Structure

```text
SURAKSHA-GRID/
│
├── backend/
│   ├── app/
│   ├── data/
│   ├── scripts/
│   ├── tests/
│   └── requirements.txt
│
├── data/
│   └── crime/
│
├── docs/
│
├── src/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   └── ...
│
├── supabase/
│   ├── migrations/
│   └── seed/
│
├── public/
├── package.json
├── next.config.ts
└── README.md
```


## Data & Safety Considerations

* The project uses historical NCRB 2023 crime data for safety intelligence.
* Historical crime records are not live incident feeds.
* Community-submitted reports may require verification.
* AI-generated observations are informational and should not be treated as confirmed facts.
* Safety scores and route recommendations cannot guarantee personal safety.
* Journey Reports are user-controlled digital journey records, not legally verified evidence.
* Some integrations may require valid API credentials to function fully.

---

## Project Objective

SURAKSHA GRID aims to make everyday mobility more safety-aware by combining navigation, historical crime intelligence, community participation, and journey documentation in a single platform.

**Our vision is to move beyond conventional navigation and make safety an important part of travel decisions.**

---

## Project Information

**Project:** SURAKSHA GRID
**Tagline:** Safety-Aware Navigation for Smarter and Safer Mobility
**Category:** AI / Smart Mobility / Public Safety
**Repository:** [GitHub – SURAKSHA GRID](https://github.com/namanagarwal17/Suraksha-Grid)

---

*Built as a hackathon project.*
