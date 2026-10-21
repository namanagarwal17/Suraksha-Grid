/**
 * Community Evidence Aggregator
 *
 * Converts a raw list of reports for one segment into a single
 * CommunityEvidence object.  This feeds the Safety Engine's `reports`
 * input — it does NOT calculate a score itself.
 *
 * Design notes
 * ─────────────
 * • A small number of reports never implies certainty in either direction.
 * • Agreement between reports raises confidence; contradiction lowers it.
 * • The resulting object is clearly labelled as community-observed data,
 *   not a verified safety assessment.
 */

export type AgreementLevel = "none" | "low" | "medium" | "high";

export interface ReportInput {
  category:  string;
  severity:  number;     // 1–5
  ageHours:  number;
}

export interface CommunityEvidence {
  reportCount:     number;
  recentCount:     number;       // reports < 24 h old
  weightedImpact:  number;       // 0–1; decay-weighted aggregate
  agreementLevel:  AgreementLevel;
  dominantCategory: string | null;
  /** Clearly labelled — never presented as a Safety Score */
  label: string;
  isDemo: boolean;               // true when populated from mock data
}

// Exponential decay matching the Python safety engine (half-life 12 h)
function decay(ageHours: number): number {
  if (ageHours <= 0) return 1;
  return Math.max(0.01, Math.pow(0.5, ageHours / 12));
}

export function aggregateCommunityEvidence(
  reports: ReportInput[],
  isDemo = false,
): CommunityEvidence {
  if (!reports.length) {
    return {
      reportCount: 0, recentCount: 0, weightedImpact: 0,
      agreementLevel: "none", dominantCategory: null,
      label: "No community observations yet", isDemo,
    };
  }

  const recentCount = reports.filter((r) => r.ageHours < 24).length;

  // Decay-weighted total impact (higher = more reports / more recent)
  const weightedImpact = Math.min(
    1,
    reports.reduce((acc, r) => acc + decay(r.ageHours) * (r.severity / 5), 0) / reports.length,
  );

  // Agreement: how consistent are the severity values?
  const severities = reports.map((r) => r.severity);
  const spread = Math.max(...severities) - Math.min(...severities);
  const agreementLevel: AgreementLevel =
    spread === 0 ? "high" : spread <= 1 ? "medium" : spread <= 2 ? "low" : "none";

  // Dominant category by frequency
  const freq: Record<string, number> = {};
  for (const r of reports) freq[r.category] = (freq[r.category] ?? 0) + 1;
  const dominantCategory = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const label =
    reports.length === 1
      ? "1 community observation (limited evidence)"
      : `${reports.length} community observations — ${agreementLevel} agreement`;

  return {
    reportCount: reports.length, recentCount, weightedImpact,
    agreementLevel, dominantCategory, label, isDemo,
  };
}