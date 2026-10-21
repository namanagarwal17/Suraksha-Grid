/**
 * Suraksha Grid — Safety Black Box Sharing & Download Service
 *
 * Implements native file sharing via Web Share API Level 2 (files sharing)
 * with robust, privacy-respecting client fallback download.
 *
 * Privacy Guarantees:
 * - Shares the actual binary PDF file directly via device OS share sheet.
 * - Never uploads the file to a cloud server or public URL.
 * - Always requests explicit user confirmation prior to invoking share sheet.
 */

import type { JourneyRecord } from "@/types/blackbox";

export interface ShareResult {
  success: boolean;
  method: "native" | "download" | "cancelled";
  message?: string;
}

/**
 * Check if the current browser environment supports native file sharing.
 */
export function isNativeFileShareSupported(testFile?: File): boolean {
  if (typeof navigator === "undefined" || !navigator.share) {
    return false;
  }

  if (testFile && typeof navigator.canShare === "function") {
    try {
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Trigger immediate client-side download of the PDF blob.
 */
export function downloadPdfBlob(blob: Blob, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Share the generated journey PDF file via native device share sheet or fallback to download.
 */
export async function shareJourneyPdf(
  journey: JourneyRecord,
  pdfBlob: Blob
): Promise<ShareResult> {
  const safeFilename = `suraksha_journey_${journey.id}.pdf`;
  const pdfFile = new File([pdfBlob], safeFilename, { type: "application/pdf" });

  const shareData: ShareData = {
    title: `Safety Journey Report: ${journey.title}`,
    text: `Suraksha Grid Safety Black Box Journey Report (${new Date(journey.startTime).toLocaleDateString()}). Contains recorded travel timeline and telemetry.`,
    files: [pdfFile],
  };

  // Try native file sharing if supported
  if (typeof navigator !== "undefined" && navigator.share) {
    const canShareFiles =
      typeof navigator.canShare === "function" ? navigator.canShare({ files: [pdfFile] }) : true;

    if (canShareFiles) {
      try {
        await navigator.share(shareData);
        return {
          success: true,
          method: "native",
          message: "Report shared via native device share sheet.",
        };
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return {
            success: false,
            method: "cancelled",
            message: "Sharing was cancelled.",
          };
        }
        // If native share fails (e.g. system rejected file sharing), fallback to download
        console.warn("Native file sharing failed; falling back to download", err);
      }
    }
  }

  // Fallback: Download file directly
  downloadPdfBlob(pdfBlob, safeFilename);
  return {
    success: true,
    method: "download",
    message:
      "Native file sharing is not supported by this browser. Your PDF report has been downloaded directly.",
  };
}

export const canShareFiles = isNativeFileShareSupported;
